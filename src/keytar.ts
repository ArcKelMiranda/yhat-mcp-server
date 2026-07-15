import type * as keytarModule from "keytar";

export const KEYTAR_SERVICE = "yhat-mcp";
export const KEYTAR_ACCOUNT = "YHAT_DB_PASSWORD";

export interface SecretStore {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadSecretStore(): Promise<SecretStore | null> {
  try {
    const keytar = (await import("keytar")) as typeof keytarModule;

    return {
      getPassword: (service: string, account: string) => keytar.getPassword(service, account),
      setPassword: (service: string, account: string, password: string) => keytar.setPassword(service, account, password),
      deletePassword: (service: string, account: string) => keytar.deletePassword(service, account),
    };
  } catch {
    return null;
  }
}

export async function saveSecret(account: string, password: string, store?: SecretStore | null): Promise<boolean> {
  const activeStore = store ?? (await loadSecretStore());

  if (activeStore === null) {
    return false;
  }

  try {
    await activeStore.setPassword(KEYTAR_SERVICE, account, password);
    return true;
  } catch {
    return false;
  }
}

export async function loadSecret(
  account: string,
  env: NodeJS.ProcessEnv = process.env,
  store?: SecretStore | null,
): Promise<string | null> {
  const activeStore = store ?? (await loadSecretStore());

  if (activeStore !== null) {
    try {
      const keychainValue = await activeStore.getPassword(KEYTAR_SERVICE, account);

      if (keychainValue !== null && keychainValue !== "") {
        return keychainValue;
      }
    } catch {
      // Ignore keychain errors and fall back to env.
    }
  }

  const envValue = env[account];
  return envValue === undefined || envValue === null || envValue === "" ? null : envValue;
}

export async function saveDatabasePassword(password: string, store?: SecretStore | null): Promise<boolean> {
  return saveSecret(KEYTAR_ACCOUNT, password, store);
}

export async function loadDatabasePassword(
  secretName: string,
  env: NodeJS.ProcessEnv = process.env,
  store?: SecretStore | null,
): Promise<string | null> {
  return loadSecret(secretName, env, store);
}

export async function resolveDatabasePassword(
  secretName: string,
  env: NodeJS.ProcessEnv = process.env,
  store?: SecretStore | null,
): Promise<string> {
  const secret = await loadDatabasePassword(secretName, env, store);

  if (secret !== null) {
    return secret;
  }

  throw new Error(`Database password not found in keychain or environment variable ${secretName}. Run 'yhat-mcp setup'.`);
}

export async function deleteSecret(account: string, store?: SecretStore | null): Promise<boolean> {
  const activeStore = store ?? (await loadSecretStore());

  if (activeStore === null) {
    return false;
  }

  try {
    return await activeStore.deletePassword(KEYTAR_SERVICE, account);
  } catch {
    return false;
  }
}
