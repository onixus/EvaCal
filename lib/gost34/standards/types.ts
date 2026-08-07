export interface StandardReference {
  id: string;
  title: string;
  version: string;
  role: string;
}

export interface DocumentProfile {
  id: string;
  title: string;
  standard: string;
  sections: string[];
}

export interface StandardProfile {
  id: string;
  name: string;
  version: string;
  effectiveFrom: string;
  primaryStandard: StandardReference;
  documentStandards: StandardReference[];
  lifecycleStandards: StandardReference[];
  testingStandards: StandardReference[];
  documentTypes: DocumentProfile[];
}
