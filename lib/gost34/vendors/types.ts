/**
 * Типы базы знаний вендоров РФ.
 *
 * Реестр — единственный источник реквизитов отечественных продуктов
 * (номера записей Минцифры/Минпромторга, сертификаты ФСТЭК/ФСБ, модели
 * лицензирования). Раньше эти сведения были размазаны по шаблонам
 * документов и пресетам; теперь шаблоны берут их отсюда.
 *
 * Правило заполнения: номер записывается только если он подтверждён
 * вендорским документом или публичным реестром (`sourceUrl`); если
 * реквизит не подтверждён — поле остаётся незаполненным, а в документ
 * попадает нейтральная формулировка без выдуманного номера.
 */

export type VendorProductCategory =
  | 'os' // операционные системы
  | 'dbms' // СУБД
  | 'ngfw' // межсетевые экраны / СОВ
  | 'endpoint' // защита конечных точек
  | 'crypto' // СКЗИ / ГОСТ-VPN
  | 'nsd' // СЗИ от НСД / доверенная загрузка
  | 'audit' // аудит данных / DCAP
  | 'siem' // мониторинг событий ИБ
  | 'backup' // резервное копирование
  | 'virtualization' // виртуализация / VDI
  | 'directory' // службы каталога
  | 'other';

/** Правило расчёта количества лицензий/единиц из ответов опросника. */
export interface QuantityRule {
  /** Ключ ответа опросника, задающий количество. */
  answerKey: string;
  /** Множитель (например, 2 узла на кластер). */
  multiplier?: number;
  /** Единица измерения: «шт.», «лиц.», «серв.», «узла». */
  unit: string;
  /** Значение по умолчанию, если ответа нет. */
  fallback: string;
}

export interface VendorSoftwareProduct {
  id: string;
  kind: 'software';
  category: VendorProductCategory;
  /** Полное наименование для граф документов. */
  name: string;
  /** Правообладатель (юридическое лицо). */
  vendor: string;
  /** Запись в Едином реестре российского ПО (Минцифры, 188-ФЗ), например «№ 369». */
  reestrMinTsifry?: string;
  /** Строка о сертификации ФСТЭК/ФСБ для граф документов. */
  certification?: string;
  /** Модель лицензирования для графы «Тип сублицензии». */
  licenseType: string;
  /** Регулярное выражение для поиска продукта в контексте проекта. */
  match: RegExp;
  quantity?: QuantityRule;
  /** Вендорский документ или запись реестра, подтверждающие реквизиты. */
  sourceUrl?: string;
  /** Дата последней сверки реквизитов с источником (ISO). */
  verifiedAt?: string;
}

export interface VendorHardwareProduct {
  id: string;
  kind: 'hardware';
  category: VendorProductCategory | 'server' | 'storage' | 'appliance';
  name: string;
  model: string;
  vendor?: string;
  /** Основание включения в реестр Минпромторга (ПП РФ № 878 / № 719). */
  reestrMinpromtorg: string;
  /** Технические характеристики по умолчанию (перекрываются контекстом). */
  defaultSpecs: string;
  formFactor: string;
  match: RegExp;
  quantity?: QuantityRule;
  sourceUrl?: string;
  verifiedAt?: string;
}

export type VendorProduct = VendorSoftwareProduct | VendorHardwareProduct;
