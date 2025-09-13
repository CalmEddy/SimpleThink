import React, { useState, useEffect } from 'react';
import { NodeEditor } from '../lib/nodeEditor.js';
import type { 
  Node, 
  SemanticGraphLite, 
  ContextFrame 
} from '../types/index.js';

interface NodeEditorProps {
  node: Node;
  graph: SemanticGraphLite;
  onUpdate: () => void;
  onCancel: () => void;
  contextFrame?: ContextFrame;
}

export const NodeEditorComponent: React.FC<NodeEditorProps> = ({ 
  node, 
  graph, 
  onUpdate, 
  onCancel, 
  contextFrame 
}) => {
  const [editText, setEditText] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidNodeType, setIsValidNodeType] = useState(false);

  useEffect(() => {
    // Check if node type is editable
    const editor = NodeEditor.getInstance();
    const canEdit = editor.isEditableNodeType(node.type);
    setIsValidNodeType(canEdit);

    if (canEdit) {
      // Set initial text based on node type
      setEditText(editor.getPrimaryTextField(node));
    }
  }, [node]);

  const handleSave = async () => {
    if (!editText.trim()) {
      setError('Text cannot be empty');
      return;
    }

    try {
      setIsUpdating(true);
      setError(null);
      
      const result = await NodeEditor.getInstance().updateNodeText(
        node.id, 
        editText.trim(), 
        graph, 
        contextFrame
      );
      
      if (result.success) {
        onUpdate();
      } else {
        setError(result.error || 'Failed to update node');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  // Show error if node type is not editable
  if (!isValidNodeType) {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Cannot Edit {NodeEditor.getInstance().getNodeTypeDisplayName(node.type)}
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  {node.type} nodes cannot be edited as they are core system components 
                  that maintain graph integrity.
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={handleCancel}
            className="btn-secondary px-4 py-2 rounded-lg font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Edit {NodeEditor.getInstance().getNodeTypeDisplayName(node.type)}:
        </label>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          rows={node.type === 'PROMPT' ? 4 : 3}
          placeholder={`Enter ${node.type.toLowerCase()} text...`}
        />
        <div className="mt-1 text-xs text-gray-500">
          {node.type === 'PROMPT' && 'Use template syntax with {slots} for dynamic content'}
          {node.type === 'PHRASE' && 'Enter the phrase text to update word connections'}
          {node.type === 'RESPONSE' && 'Enter the response text to update word connections'}
        </div>
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <div className="mt-1 text-sm text-red-700">{error}</div>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex space-x-3">
        <button
          onClick={handleSave}
          disabled={isUpdating || !editText.trim()}
          className="btn-primary px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUpdating ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isUpdating}
          className="btn-secondary px-4 py-2 rounded-lg font-medium disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {/* Additional info for different node types */}
      <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-md">
        <div className="font-medium mb-1">What happens when you edit:</div>
        {node.type === 'PHRASE' && (
          <ul className="space-y-1 text-xs">
            <li>• Word connections will be regenerated based on new text</li>
            <li>• POS patterns and lemmas will be updated</li>
            <li>• Topic and session relationships are preserved</li>
          </ul>
        )}
        {node.type === 'RESPONSE' && (
          <ul className="space-y-1 text-xs">
            <li>• Word connections will be regenerated based on new text</li>
            <li>• POS patterns and lemmas will be updated</li>
            <li>• Prompt relationship and rating are preserved</li>
          </ul>
        )}
        {node.type === 'PROMPT' && (
          <ul className="space-y-1 text-xs">
            <li>• Template slots will be re-parsed from new text</li>
            <li>• Filler connections will be regenerated</li>
            <li>• Topic and session relationships are preserved</li>
          </ul>
        )}
      </div>
    </div>
  );
};
