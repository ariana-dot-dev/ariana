export interface AutomationJSON {
  name: string;
  trigger: {
    type: string;
    fileGlob?: string;
    commandRegex?: string;
    automationId?: string;
  };
  scriptLanguage: 'bash' | 'javascript' | 'python';
  scriptContent: string;
  blocking?: boolean;
  feedOutput?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates JSON against the Automation schema
 * Strict validation: must have name, trigger, scriptLanguage, and scriptContent fields
 */
export function validateAutomationJSON(jsonString: string): ValidationResult {
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

  // Check for required field: trigger
  if (!('trigger' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "trigger"'
    };
  }

  if (typeof parsed.trigger !== 'object' || parsed.trigger === null || Array.isArray(parsed.trigger)) {
    return {
      isValid: false,
      error: 'Field "trigger" must be an object'
    };
  }

  // Check trigger.type
  if (!('type' in parsed.trigger)) {
    return {
      isValid: false,
      error: 'Missing required field: "trigger.type"'
    };
  }

  if (typeof parsed.trigger.type !== 'string') {
    return {
      isValid: false,
      error: 'Field "trigger.type" must be a string'
    };
  }

  // Validate optional trigger fields
  if ('fileGlob' in parsed.trigger && typeof parsed.trigger.fileGlob !== 'string') {
    return {
      isValid: false,
      error: 'Field "trigger.fileGlob" must be a string if provided'
    };
  }

  if ('commandRegex' in parsed.trigger && typeof parsed.trigger.commandRegex !== 'string') {
    return {
      isValid: false,
      error: 'Field "trigger.commandRegex" must be a string if provided'
    };
  }

  if ('automationId' in parsed.trigger && typeof parsed.trigger.automationId !== 'string') {
    return {
      isValid: false,
      error: 'Field "trigger.automationId" must be a string if provided'
    };
  }

  // Check for required field: scriptLanguage
  if (!('scriptLanguage' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "scriptLanguage"'
    };
  }

  if (!['bash', 'javascript', 'python'].includes(parsed.scriptLanguage)) {
    return {
      isValid: false,
      error: 'Field "scriptLanguage" must be "bash", "javascript", or "python"'
    };
  }

  // Check for required field: scriptContent
  if (!('scriptContent' in parsed)) {
    return {
      isValid: false,
      error: 'Missing required field: "scriptContent"'
    };
  }

  if (typeof parsed.scriptContent !== 'string') {
    return {
      isValid: false,
      error: 'Field "scriptContent" must be a string'
    };
  }

  // Validate optional fields
  if ('blocking' in parsed && typeof parsed.blocking !== 'boolean') {
    return {
      isValid: false,
      error: 'Field "blocking" must be a boolean if provided'
    };
  }

  if ('feedOutput' in parsed && typeof parsed.feedOutput !== 'boolean') {
    return {
      isValid: false,
      error: 'Field "feedOutput" must be a boolean if provided'
    };
  }

  // Check for extra fields at root level
  const allowedFields = new Set(['name', 'trigger', 'scriptLanguage', 'scriptContent', 'blocking', 'feedOutput']);
  const extraFields = Object.keys(parsed).filter(key => !allowedFields.has(key));

  if (extraFields.length > 0) {
    return {
      isValid: false,
      error: `Unexpected field(s): ${extraFields.join(', ')}`
    };
  }

  // Check for extra fields in trigger
  const allowedTriggerFields = new Set(['type', 'fileGlob', 'commandRegex', 'automationId']);
  const extraTriggerFields = Object.keys(parsed.trigger).filter(key => !allowedTriggerFields.has(key));

  if (extraTriggerFields.length > 0) {
    return {
      isValid: false,
      error: `Unexpected field(s) in trigger: ${extraTriggerFields.join(', ')}`
    };
  }

  return { isValid: true };
}

/**
 * Parses and validates JSON, returning typed data if valid
 */
export function parseAutomationJSON(jsonString: string): { data?: AutomationJSON; error?: string } {
  const validation = validateAutomationJSON(jsonString);

  if (!validation.isValid) {
    return { error: validation.error };
  }

  try {
    const data = JSON.parse(jsonString) as AutomationJSON;
    return { data };
  } catch (e) {
    return { error: 'Failed to parse JSON' };
  }
}
