import React, { useState, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useActiveNodes } from '../contexts/ActiveNodesContext.jsx';
import type { SemanticGraphLite } from '../lib/semanticGraphLite.js';
import type { TopicNode } from '../types/index.js';

interface TopicChipProps {
  graph: SemanticGraphLite;
}

export interface TopicChipRef {
  startTopicEntry: () => void;
}

const TopicChip = forwardRef<TopicChipRef, TopicChipProps>(({ graph }, ref) => {
  const { contextFrame, startTopicSession, endCurrentSession } = useActiveNodes();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get existing topics - use topic count as dependency to force refresh
  const topicCount = graph.getNodesByType('TOPIC').length;
  const existingTopics = useMemo(() => {
    return graph.getNodesByType('TOPIC') as TopicNode[];
  }, [graph, topicCount]);

  // Filter topics based on input
  const filteredTopics = useMemo(() => {
    if (!inputValue.trim()) return existingTopics;
    const term = inputValue.toLowerCase();
    return existingTopics.filter(topic => 
      topic.text.toLowerCase().includes(term) ||
      topic.lemmas.some(lemma => lemma.toLowerCase().includes(term))
    );
  }, [existingTopics, inputValue]);

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStartTopic = () => {
    setInputValue('');
    setIsEditing(true);
    setShowDropdown(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Expose the startTopicEntry function to parent components
  useImperativeHandle(ref, () => ({
    startTopicEntry: handleStartTopic
  }));

  const handleChangeTopic = () => {
    setInputValue(contextFrame?.topicText || '');
    setIsEditing(true);
    setShowDropdown(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowDropdown(true);
  };

  const handleTopicSelect = (topicText: string) => {
    setInputValue(topicText);
    setShowDropdown(false);
    startTopicSession(graph, topicText);
    setIsEditing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      startTopicSession(graph, inputValue.trim());
      setIsEditing(false);
      setShowDropdown(false);
    }
  };

  const handleEndSession = () => {
    if (confirm('End current session?')) {
      endCurrentSession(graph);
    }
  };

  if (!contextFrame) {
    if (isEditing) {
      return (
        <div className="relative">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="Start Topic / Premise..."
              className="px-3 py-1 border border-blue-300 rounded-md text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-1 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600"
            >
              Cancel
            </button>
          </form>
          
          {showDropdown && filteredTopics.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto"
            >
              {filteredTopics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => handleTopicSelect(topic.text)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
                >
                  <div className="font-medium text-gray-800">{topic.text}</div>
                  {topic.lemmas.length > 0 && (
                    <div className="text-xs text-gray-500">{topic.lemmas.join(', ')}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button 
        onClick={handleStartTopic}
        className="px-3 py-1 rounded-full border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium"
      >
        + Start Topic
      </button>
    );
  }

  if (isEditing) {
    return (
      <div className="relative">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Change Topic / Premise..."
            className="px-3 py-1 border border-green-300 rounded-md text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            type="submit"
            className="px-3 py-1 bg-green-500 text-white rounded-md text-sm hover:bg-green-600"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="px-3 py-1 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600"
          >
            Cancel
          </button>
        </form>
        
        {showDropdown && filteredTopics.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto"
          >
            {filteredTopics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => handleTopicSelect(topic.text)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium text-gray-800">{topic.text}</div>
                {topic.lemmas.length > 0 && (
                  <div className="text-xs text-gray-500">{topic.lemmas.join(', ')}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="px-3 py-1 rounded-full border border-green-300 bg-green-50 text-green-700 text-sm font-medium">
        Topic: <strong>{contextFrame.topicText}</strong>
      </span>
      <button 
        onClick={handleChangeTopic}
        className="text-sm text-blue-600 hover:text-blue-800 underline"
      >
        Change
      </button>
      <button 
        onClick={handleEndSession}
        className="text-sm text-red-600 hover:text-red-800 underline"
      >
        End
      </button>
    </div>
  );
});

TopicChip.displayName = 'TopicChip';

export default TopicChip;
