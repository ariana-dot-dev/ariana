/**
 * Utility functions for generating fork names with superscript exponents
 */

/**
 * Convert a number to superscript characters
 * Supports numbers 0-9, and combinations for numbers > 9
 */
function numberToSuperscript(num: number): string {
  if (num >= 1000) {
    return '∞';
  }

  const superscriptDigits: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹'
  };

  return num
    .toString()
    .split('')
    .map(digit => superscriptDigits[digit] || digit)
    .join('');
}

/**
 * Extract the base name and exponent from a fork name
 * Examples:
 *   "my-agent" -> { baseName: "my-agent", exponent: 0 }
 *   "my-agent (fork)" -> { baseName: "my-agent", exponent: 1 }
 *   "my-agent (fork²)" -> { baseName: "my-agent", exponent: 2 }
 *   "my-agent (fork³)" -> { baseName: "my-agent", exponent: 3 }
 *   "my-agent (fork∞)" -> { baseName: "my-agent", exponent: 1000 }
 */
function parseForkName(name: string): { baseName: string; exponent: number } {
  // Match pattern: "basename (fork)" or "basename (fork²)" etc.
  const forkPattern = /^(.+?)\s*\(fork([⁰¹²³⁴⁵⁶⁷⁸⁹∞]*)\)$/;
  const match = name.match(forkPattern);

  if (!match) {
    return { baseName: name, exponent: 0 };
  }

  const baseName = match[1].trim();
  const superscriptPart = match[2];

  // If no superscript, it's "(fork)" which is fork¹
  if (superscriptPart === '') {
    return { baseName, exponent: 1 };
  }

  // If infinity symbol, treat as 1000+
  if (superscriptPart === '∞') {
    return { baseName, exponent: 1000 };
  }

  // Convert superscript back to normal number
  const superscriptToNormal: Record<string, string> = {
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9'
  };

  const normalNumber = superscriptPart
    .split('')
    .map(char => superscriptToNormal[char] || char)
    .join('');

  const exponent = parseInt(normalNumber, 10);
  return { baseName, exponent: isNaN(exponent) ? 1 : exponent };
}

/**
 * Generate a fork name with the appropriate exponent
 * Examples:
 *   generateForkName("my-agent") -> "my-agent (fork)"
 *   generateForkName("my-agent (fork)") -> "my-agent (fork²)"
 *   generateForkName("my-agent (fork²)") -> "my-agent (fork³)"
 *   generateForkName("my-agent (fork⁹⁹⁹)") -> "my-agent (fork∞)"
 *   generateForkName("my-agent (fork∞)") -> "my-agent (fork∞)"
 */
export function generateForkName(sourceAgentName: string): string {
  const { baseName, exponent } = parseForkName(sourceAgentName);

  const newExponent = exponent + 1;

  // For first fork, use "(fork)" without superscript
  if (newExponent === 1) {
    return `${baseName} (fork)`;
  }

  // For >= 1000, use infinity symbol and keep it at infinity
  if (newExponent >= 1000) {
    return `${baseName} (fork∞)`;
  }

  // For 2+, use superscript
  return `${baseName} (fork${numberToSuperscript(newExponent)})`;
}
