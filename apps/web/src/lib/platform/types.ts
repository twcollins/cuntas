// What the app needs from the device. The web build and the iOS and Android apps each provide
// one of these; the rest of the app never imports a storage or file API directly.

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Writes and deletes together. The native store applies them in one transaction, so a crash leaves the previous state. */
  write(set: [key: string, value: unknown][], del?: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

export interface OutgoingFile {
  name: string;
  mime: string;
  data: string;
}

export interface FileGateway {
  /** Hands files to the user: downloads on the web, one share sheet (Save to Files, AirDrop, Drive) in the apps. */
  save(files: OutgoingFile[]): Promise<void>;
  /** Calls back with files opened in Cúntas from elsewhere (Files, the share sheet, an installed web app's file handler). */
  onOpen(listener: (files: File[]) => void): () => void;
}

export interface Platform {
  name: "web" | "ios" | "android" | "fake";
  kv: KeyValueStore;
  files: FileGateway;
  /** A storage problem found at start-up, shown on Settings until the next launch. */
  warning?: string;
}
