export const ROLES = [
  { value: "consultant", label: "Консультант" },
  { value: "developer", label: "Разработчик" },
  { value: "engineer", label: "Инженер" },
  { value: "analyst", label: "Аналитик" },
  { value: "architect", label: "Архитектор" },
  { value: "customer", label: "Заказчик" },
  { value: "other", label: "Другое" },
] as const;

export type Role = (typeof ROLES)[number]["value"];

// Stages performed by these roles require a customer sign-off task before the next stage starts.
export const APPROVAL_REQUIRED_ROLES: Role[] = ["consultant", "developer", "engineer", "analyst"];

export const APPROVAL_BUSINESS_DAYS = 3;

export function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  approved: "Утверждён",
  planned: "Запланировано",
  in_progress: "В работе",
  done: "Выполнено",
  rejected: "Отклонено",
};
