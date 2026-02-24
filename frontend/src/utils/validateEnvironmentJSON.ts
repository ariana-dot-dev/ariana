export interface EnvironmentJSON {
  name: string;
  envContents: string;
  secretFiles: Array<{
    id?: string;
    path: string;
    contents: string;
  }>;
  sshKeyPair?: {
    publicKey: string;
    privateKey: string;
    keyName: string;
  };
  automations?: Array<{
    name: string;
    trigger: {
      type: string;
      fileGlob?: string;
      commandRegex?: string;
      automationId?: string;
    };
    scriptLanguage: string;
    scriptContent: string;
    blocking: boolean;
    feedOutput: boolean;
  }>;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates JSON against the Environment schema
 * Strict validation: must have name, envContents, and secretFiles fields
 */
export function validateEnvironmentJSON(jsonString: string): ValidationResult {
  // First check if it's valid JSON
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    const error = e as Error;
    return {
      isValid: false,
      error: `Invalid JSON syntax: ${error.message}`
    };
  }

  // Check if it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      isValid: false,
      error: 'JSON must be an object, not an array or primitive'
    };
  }

  // Check for required field: name
  if (!('name' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "name"'
    };
  }

  if (typeof parsed.name !== 'string') {
    return {
      isValid: false,
      error: 'Field "name" must be a string'
    };
  }

  // Check for required field: envContents
  if (!('envContents' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "envContents"'
    };
  }

  if (typeof parsed.envContents !== 'string') {
    return {
      isValid: false,
      error: 'Field "envContents" must be a string'
    };
  }

  // Check for required field: secretFiles
  if (!('secretFiles' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "secretFiles"'
    };
  }

  if (!Array.isArray(parsed.secretFiles)) {
    return {
      isValid: false,
      error: 'Field "secretFiles" must be an array'
    };
  }

  // Validate each secret file
  for (let i = 0; i < parsed.secretFiles.length; i++) {
    const file = parsed.secretFiles[i];

    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      return {
        isValid: false,
        error: `secretFiles[${i}] must be an object`
      };
    }

    // id is optional, but if present must be string
    if ('id' in file && typeof file.id !== 'string') {
      return {
        isValid: false,
        error: `secretFiles[${i}].id must be a string if provided`
      };
    }

    // path is required
    if (!('path' in file)) {
      return {
        isValid: false,
        error: `secretFiles[${i}] missing required field "path"`
      };
    }

    if (typeof file.path !== 'string') {
      return {
        isValid: false,
        error: `secretFiles[${i}].path must be a string`
      };
    }

    // contents is required
    if (!('contents' in file)) {
      return {
        isValid: false,
        error: `secretFiles[${i}] missing required field "contents"`
      };
    }

    if (typeof file.contents !== 'string') {
      return {
        isValid: false,
        error: `secretFiles[${i}].contents must be a string`
      };
    }
  }

  // Validate automations if present (optional field)
  if ('automations' in parsed) {
    if (!Array.isArray(parsed.automations)) {
      return {
        isValid: false,
        error: 'Field "automations" must be an array if provided'
      };
    }

    // Validate each automation
    for (let i = 0; i < parsed.automations.length; i++) {
      const automation = parsed.automations[i];

      if (typeof automation !== 'object' || automation === null || Array.isArray(automation)) {
        return {
          isValid: false,
          error: `automations[${i}] must be an object`
        };
      }

      // name is required
      if (!('name' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "name"`
        };
      }

      if (typeof automation.name !== 'string') {
        return {
          isValid: false,
          error: `automations[${i}].name must be a string`
        };
      }

      // trigger is required
      if (!('trigger' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "trigger"`
        };
      }

      if (typeof automation.trigger !== 'object' || automation.trigger === null || Array.isArray(automation.trigger)) {
        return {
          isValid: false,
          error: `automations[${i}].trigger must be an object`
        };
      }

      if (!('type' in automation.trigger) || typeof automation.trigger.type !== 'string') {
        return {
          isValid: false,
          error: `automations[${i}].trigger.type is required and must be a string`
        };
      }

      // scriptLanguage is required
      if (!('scriptLanguage' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "scriptLanguage"`
        };
      }

      if (typeof automation.scriptLanguage !== 'string') {
        return {
          isValid: false,
          error: `automations[${i}].scriptLanguage must be a string`
        };
      }

      // scriptContent is required
      if (!('scriptContent' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "scriptContent"`
        };
      }

      if (typeof automation.scriptContent !== 'string') {
        return {
          isValid: false,
          error: `automations[${i}].scriptContent must be a string`
        };
      }

      // blocking is required
      if (!('blocking' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "blocking"`
        };
      }

      if (typeof automation.blocking !== 'boolean') {
        return {
          isValid: false,
          error: `automations[${i}].blocking must be a boolean`
        };
      }

      // feedOutput is required
      if (!('feedOutput' in automation)) {
        return {
          isValid: false,
          error: `automations[${i}] missing required field "feedOutput"`
        };
      }

      if (typeof automation.feedOutput !== 'boolean') {
        return {
          isValid: false,
          error: `automations[${i}].feedOutput must be a boolean`
        };
      }

      // Check for extra fields
      const allowedAutomationFields = new Set(['name', 'trigger', 'scriptLanguage', 'scriptContent', 'blocking', 'feedOutput']);
      const extraAutomationFields = Object.keys(automation).filter(key => !allowedAutomationFields.has(key));

      if (extraAutomationFields.length > 0) {
        return {
          isValid: false,
          error: `automations[${i}] has unexpected field(s): ${extraAutomationFields.join(', ')}`
        };
      }
    }
  }

  // Check for extra fields at root level
  const allowedFields = new Set(['name', 'envContents', 'secretFiles', 'sshKeyPair', 'automations']);
  const extraFields = Object.keys(parsed).filter(key => !allowedFields.has(key));

  if (extraFields.length > 0) {
    return {
      isValid: false,
      error: `Unexpected field(s): ${extraFields.join(', ')}`
    };
  }

  return { isValid: true };
}

/**
 * Parses and validates JSON, returning typed data if valid
 */
export function parseEnvironmentJSON(jsonString: string): { data?: EnvironmentJSON; error?: string } {
  const validation = validateEnvironmentJSON(jsonString);

  if (!validation.isValid) {
    return { error: validation.error };
  }

  try {
    const data = JSON.parse(jsonString) as EnvironmentJSON;
    return { data };
  } catch (e) {
    return { error: 'Failed to parse JSON' };
  }
}
