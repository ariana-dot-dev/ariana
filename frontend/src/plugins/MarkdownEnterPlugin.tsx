import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $createCodeNode, $isCodeNode, CodeNode } from "@lexical/code";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from "lexical";
import { $createTextNode } from "lexical";

export default function MarkdownEnterPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        // If we're in a text node, check for ``` pattern
        if ($isTextNode(anchorNode)) {
          const parent = anchorNode.getParent();

          // Check if already in a code block and trying to exit with ```
          if ($isCodeNode(parent)) {
            const textContent = anchorNode.getTextContent();
            const beforeCursor = textContent.substring(0, anchor.offset);
            const lines = beforeCursor.split('\n');
            const currentLine = lines[lines.length - 1];

            // Check if current line is ```
            if (currentLine.trim() === '```') {
              event?.preventDefault();

              editor.update(() => {
                // Create a new paragraph after the code block (keep the ``` in the code)
                const newParagraph = $createParagraphNode();
                parent.insertAfter(newParagraph);
                newParagraph.select();
              });

              return true;
            }
          }

          // Check for ``` at start to create code block
          const textContent = anchorNode.getTextContent();
          const beforeCursor = textContent.substring(0, anchor.offset);
          const match = beforeCursor.match(/^\s*```(\w*)\s*$/);

          if (match) {
            event?.preventDefault();

            editor.update(() => {
              const language = match[1] || undefined;
              const codeNode = $createCodeNode(language);

              // Replace current node with code node
              if (parent) {
                parent.replace(codeNode);
                codeNode.select();
              }
            });

            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor]);

  return null;
}
