import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Пароль стендовых учёток берётся из окружения: общего дефолтного пароля в
 * проекте нет. Пайплайн сидит все роли одним паролем (SEED_DEFAULT_PASSWORD),
 * поэтому им же логинятся тех.писатель и ГАП.
 */
export const E2E_PASSWORD = process.env.E2E_ARCHITECT_PASSWORD;

/** Пароль, на который меняется выданный сидом при первом входе. */
export const FORCED_NEW_PASSWORD = 'newsecurepassword123';

/**
 * Вход под ролью с прохождением обязательной смены пароля. После входа все
 * роли попадают на рабочий стол `/`; сид помечает учётки `mustChangePassword`,
 * и первый вход всегда заканчивается сменой на `/account`.
 * Возвращает пароль, действующий после входа.
 */
export async function loginAs(page: Page, username: string, password: string): Promise<string> {
  // Сид помечает учётки mustChangePassword, и первый вход в прогоне меняет
  // пароль на FORCED_NEW_PASSWORD. Следующий сценарий того же прогона входит
  // уже новым паролем, поэтому при отказе пробуем его.
  const candidates =
    password === FORCED_NEW_PASSWORD ? [password] : [password, FORCED_NEW_PASSWORD];
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await loginOnce(page, username, candidate);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!/Login failed/.test(lastError.message)) throw lastError;
    }
  }
  throw lastError ?? new Error('Login failed');
}

async function loginOnce(page: Page, username: string, password: string): Promise<string> {
  await page.goto('/login');
  const inputs = page.locator('.input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(password);
  await page.click('button[type="submit"]');

  // Либо уходим со страницы входа, либо форма показывает ошибку — тогда падаем
  // с её текстом, а не по таймауту без объяснения.
  const errorLocator = page
    .locator('text=Неверный логин или пароль')
    .or(page.locator('text=Ошибка'));
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }),
    errorLocator.waitFor({ state: 'visible', timeout: 20000 }).then(async () => {
      throw new Error(`Login failed: ${await errorLocator.innerText()}`);
    }),
  ]);

  if (/\/account/.test(page.url())) {
    const passInputs = page.locator('input[type="password"]');
    await passInputs.nth(0).fill(password);
    await passInputs.nth(1).fill(FORCED_NEW_PASSWORD);
    await page.getByRole('button', { name: /Сменить пароль/i }).click();
    await expect(page.getByText('Пароль изменён')).toBeVisible({ timeout: 15000 });
    return FORCED_NEW_PASSWORD;
  }
  return password;
}

/** Создаёт проект через модальное окно реестра и открывает его карточку. */
export async function createProject(page: Page, name: string, customer: string): Promise<void> {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await expect(page.getByText('Создать новый проект')).toBeVisible();
  await page.locator('input[placeholder*="АС «Единый"]').fill(name);
  await page.locator('input[placeholder*="Северный банк"]').fill(customer);
  await page.locator('form').getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/**
 * Проходит пресейл-мастер из карточки проекта и создаёт расчёт.
 * Возвращает id расчёта из адреса хаба.
 */
export async function createCalculationViaWizard(page: Page): Promise<string> {
  await page
    .getByRole('link', { name: /Создать расчёт/ })
    .first()
    .click();

  await expect(page.locator('label').filter({ hasText: 'Название проекта' })).toBeVisible();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/Опросник/).first()).toBeVisible();

  // Все обязательные поля опросника — иначе HTML5-валидация не пустит дальше.
  const requiredInputs = page.locator('input[required], select[required], textarea[required]');
  const count = await requiredInputs.count();
  for (let i = 0; i < count; i++) {
    const field = requiredInputs.nth(i);
    const type = await field.getAttribute('type');
    const tagName = await field.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      const options = field.locator('option');
      if ((await options.count()) > 1) {
        await field.selectOption((await options.nth(1).getAttribute('value'))!);
      }
    } else if (type === 'number') {
      await field.fill('1');
    } else {
      await field.fill('test');
    }
  }

  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText('Итог: этапы и роли')).toBeVisible();
  await page.getByRole('button', { name: 'Создать расчёт' }).click();

  await page.waitForURL(/\/(calculations|presale)\/[a-z0-9]+/i, { timeout: 20000 });
  const match = page.url().match(/\/(?:calculations|presale)\/([a-z0-9]+)/i);
  if (!match) throw new Error(`Не удалось прочитать id расчёта из ${page.url()}`);
  return match[1];
}

/**
 * Перетаскивание карточки доски. `locator.dragTo` делает одно движение мыши,
 * и если исходная карточка была за краем экрана, браузер не начинает
 * HTML5-drag. Явная последовательность с двумя наведениями надёжнее.
 */
export async function dragCardTo(page: Page, card: Locator, target: Locator): Promise<void> {
  // Обработчики drag-событий появляются после гидратации: пока клиентские
  // чанки не загружены, карточка видна, но перетаскивание ни к чему не ведёт.
  await page.waitForLoadState('networkidle');
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Карточка или колонка не видны');
  // Явные координаты и промежуточные шаги: Chromium начинает HTML5-drag только
  // после движения нажатой мыши, а один прыжок к цели он иногда пропускает.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(80, to.height / 2), { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.move(to.x + to.width / 2 + 2, to.y + Math.min(82, to.height / 2), { steps: 2 });
  await page.mouse.up();
}
