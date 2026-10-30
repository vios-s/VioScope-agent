import { readThemeMeetingConfig } from './store';

// "Coordinator" is a label derived from theme configuration (coordinator_user), never an account role.
// Returns theme ids per exact normalized username; an absent or unreadable configuration means none (logged).
export async function coordinatorThemesByUsername(): Promise<Map<string, string[]>> {
  const themes = new Map<string, string[]>();
  const config = await readThemeMeetingConfig().then(({ config }) => config, (error) => {
    console.warn('Could not read theme meeting configuration for coordinator labels:', error instanceof Error ? error.message : error);
    return null;
  });
  for (const theme of config?.themes || []) {
    const username = theme.coordinator_user?.trim().toLowerCase();
    if (username) themes.set(username, [...(themes.get(username) || []), theme.theme_id]);
  }
  return themes;
}

export async function withCoordinatorThemes<T extends { username: string }>(users: T[]): Promise<Array<T & { coordinatorThemes: string[] }>> {
  const themes = await coordinatorThemesByUsername();
  return users.map((user) => ({ ...user, coordinatorThemes: themes.get(user.username.trim().toLowerCase()) || [] }));
}
