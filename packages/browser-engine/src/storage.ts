import { isAbsolute, resolve, sep } from 'node:path';
import { AppError } from '@saa/domain';

/**
 * Resolusi path absolut. Perbandingan containment memakai huruf kecil di Windows
 * karena filesystem di sana case-insensitive.
 */
export function assertInsideRoot(root: string, target: string): string {
  const rootPath = resolve(root);
  const targetPath = isAbsolute(target) ? resolve(target) : resolve(rootPath, target);
  const normalize = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const rootKey = normalize(rootPath);
  const targetKey = normalize(targetPath);
  const prefix = rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`;

  if (targetKey !== rootKey && !targetKey.startsWith(prefix)) {
    throw new AppError('VALIDATION', `path ${target} berada di luar direktori output`);
  }
  return targetPath;
}
