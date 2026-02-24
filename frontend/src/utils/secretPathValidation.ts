// Validation for secret file paths

export interface PathValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateSecretFilePath(path: string): PathValidationResult {
  // Empty path
  if (!path || path.trim() === '') {
    return { isValid: false, error: 'Path cannot be empty' };
  }

  const trimmedPath = path.trim();

  // Cannot start with slash
  if (trimmedPath.startsWith('/')) {
    return { isValid: false, error: 'Path cannot start with /' };
  }

  // Cannot start with ./
  if (trimmedPath.startsWith('./')) {
    return { isValid: false, error: 'Path cannot start with ./' };
  }

  // Cannot contain backslashes (Windows paths)
  if (trimmedPath.includes('\\')) {
    return { isValid: false, error: 'Use forward slashes (/) only' };
  }

  // Cannot contain ../ (parent directory traversal)
  if (trimmedPath.includes('../')) {
    return { isValid: false, error: 'Path cannot contain ../' };
  }

  // Cannot be just "." or ".."
  if (trimmedPath === '.' || trimmedPath === '..') {
    return { isValid: false, error: 'Invalid path' };
  }

  // Check for invalid Unix filename characters
  // Valid characters: alphanumeric, dash, underscore, dot, forward slash
  // We allow most characters except control characters and some special ones
  const invalidCharsRegex = /[\x00-\x1F\x7F<>:"|?*]/;
  if (invalidCharsRegex.test(trimmedPath)) {
    return { isValid: false, error: 'Path contains invalid characters' };
  }

  // Cannot end with slash
  if (trimmedPath.endsWith('/')) {
    return { isValid: false, error: 'Path cannot end with /' };
  }

  // Cannot have consecutive slashes
  if (trimmedPath.includes('//')) {
    return { isValid: false, error: 'Path cannot contain consecutive slashes' };
  }

  // Path components cannot be empty (e.g., "foo//bar")
  const components = trimmedPath.split('/');
  for (const component of components) {
    if (component === '') {
      return { isValid: false, error: 'Path has empty component' };
    }
    if (component === '.') {
      return { isValid: false, error: 'Path cannot contain . components' };
    }
    if (component === '..') {
      return { isValid: false, error: 'Path cannot contain .. components' };
    }
  }

  // All validations passed
  return { isValid: true };
}
