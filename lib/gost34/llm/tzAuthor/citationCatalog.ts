export interface CitationAlias {
  id: string; // fstek_21 | fz_152 | gost-34.602-2020 | …
  kind: 'regulatory' | 'profile';
  aliases: RegExp; // уже с NFKC/ё-нормализацией на входе
}

export const CITATION_CATALOG: CitationAlias[] = [
  {
    id: 'fstek_21',
    kind: 'regulatory',
    aliases: /приказ[а-яё]*\s+фстэк(?:\s+россии)?\s*№?\s*21|фстэк\s*№?\s*21|fstek[_\s-]*21/i,
  },
  {
    id: 'fstek_117',
    kind: 'regulatory',
    aliases: /приказ[а-яё]*\s+фстэк(?:\s+россии)?\s*№?\s*117|фстэк\s*№?\s*117|fstek[_\s-]*117/i,
  },
  {
    id: 'fstek_239',
    kind: 'regulatory',
    aliases: /приказ[а-яё]*\s+фстэк(?:\s+россии)?\s*№?\s*239|фстэк\s*№?\s*239/i,
  },
  { id: 'fz_152', kind: 'regulatory', aliases: /152-?\s*фз|федеральн\w*\s+закон[а-яё]*\s*152/i },
  {
    id: 'fz_187_kii',
    kind: 'regulatory',
    aliases: /187-?\s*фз|закон[а-яё]*\s+о\s+безопасности\s+кии/i,
  },
  { id: 'fz_188_reestr', kind: 'regulatory', aliases: /188-?\s*фз|единый\s+реестр\s+российск/i },
  { id: 'gost_57580', kind: 'regulatory', aliases: /гост\s*р?\s*57580/i },
  { id: 'cb_683p', kind: 'regulatory', aliases: /683-п|положение\s+цб.*683/i },
  { id: 'cb_757p', kind: 'regulatory', aliases: /757-п|положение\s+цб.*757/i },
  { id: 'cb_719p', kind: 'regulatory', aliases: /719-п|положение\s+цб.*719/i },
  {
    id: 'fsb_282_gossopka',
    kind: 'regulatory',
    aliases: /приказ[а-яё]*\s+фсб\s*№?\s*282|госсопка|нкцки/i,
  },
  // sla_999 в каталог НЕ входит: «доступность 99,9 %» — измерение, не цитата.
  { id: 'wcag_52872', kind: 'regulatory', aliases: /гост\s*р?\s*52872|wcag/i },
  { id: 'gost-34.602-2020', kind: 'profile', aliases: /гост\s*34\.602-2020/i },
  { id: 'gost-34.201-2020', kind: 'profile', aliases: /гост\s*34\.201-2020/i },
  { id: 'gost-r-59793-2021', kind: 'profile', aliases: /гост\s*р?\s*59793-2021/i },
  { id: 'gost-r-59792-2021', kind: 'profile', aliases: /гост\s*р?\s*59792-2021/i },
  { id: 'gost-r-59795-2021', kind: 'profile', aliases: /гост\s*р?\s*59795-2021/i },
];

export const CITATION_SHAPE =
  /(?<=^|[^0-9a-zа-яё])(?:фз|фстэк|фсб|цб|приказ[а-яё]*|положение\s+\d+-п|гост(?:\s*р)?)(?=$|[^0-9a-zа-яё])/iu;
