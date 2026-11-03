export const temporaryPasswordMinLength = 8;
export const temporaryPasswordHint = `Use at least ${temporaryPasswordMinLength} characters.`;

export function isValidTemporaryPassword(password: string): boolean {
  return password.trim().length >= temporaryPasswordMinLength;
}
