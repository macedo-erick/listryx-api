import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CONFIG, type Config } from '../config';

export type KeycloakUser = Record<string, unknown>;

/** Renewed this far before expiry so a call never races the token going stale. */
const EXPIRY_MARGIN_MS = 30_000;

interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}

interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

/**
 * The slice of Keycloak's Admin API the app needs: reading and updating one user.
 *
 * Callers pass the `sub` of the authenticated principal — nothing here checks who is asking, so
 * exposing it for any other id would let one user edit another.
 */
@Injectable()
export class KeycloakAdminClient {
  private readonly logger = new Logger(KeycloakAdminClient.name);
  private cachedToken: CachedToken | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async findUser(userId: string): Promise<KeycloakUser> {
    const response = await this.request(`/admin/realms/${this.realm}/users/${userId}`);

    if (response.status === 404) {
      throw new NotFoundException(`User not found: ${userId}`);
    }

    await this.assertOk(response, 'read a user');

    return (await response.json()) as KeycloakUser;
  }

  /**
   * A partial update — Keycloak merges the attributes present and leaves the rest alone, so the
   * caller only sends what it means to change.
   */
  async updateUser(userId: string, attributes: KeycloakUser): Promise<void> {
    const response = await this.request(`/admin/realms/${this.realm}/users/${userId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(attributes),
    });

    if (response.status === 409) {
      throw new ConflictException('That email address is already in use');
    }

    await this.assertOk(response, 'update a user');
  }

  private get realm(): string {
    return this.config.KEYCLOAK_REALM;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.accessToken()}`);

    return fetch(`${this.config.KEYCLOAK_SERVER_URL}${path}`, { ...init, headers });
  }

  /** A client-credentials token for the service account, reused until it is nearly expired. */
  private async accessToken(): Promise<string> {
    const cached = this.cachedToken;

    if (cached !== null && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
      return cached.value;
    }

    const response = await fetch(
      `${this.config.KEYCLOAK_SERVER_URL}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.KEYCLOAK_ADMIN_CLIENT_ID,
          client_secret: this.config.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }),
      },
    );

    await this.assertOk(response, 'fetch a service-account token');

    const token = (await response.json()) as TokenResponse;

    this.cachedToken = {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };

    return token.access_token;
  }

  private async assertOk(response: Response, what: string): Promise<void> {
    if (response.ok) {
      return;
    }

    const detail = await response.text().catch(() => '');

    this.logger.error(`Keycloak admin failed to ${what}: ${String(response.status)} ${detail}`);

    throw new Error(`Keycloak admin request failed with ${String(response.status)}`);
  }
}
