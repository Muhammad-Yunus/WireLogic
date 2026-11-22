import React from 'react';

interface SyntaxCodeBlockProps {
  code: string;
  language: 'sql' | 'javascript';
  maxLines?: number;
  compact?: boolean;
}

const SQL_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'ORDER',
  'BY',
  'DESC',
  'ASC',
  'LIMIT',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'AND',
  'OR',
  'AS',
  'JOIN',
  'LEFT',
  'ON',
  'GROUP',
  'HAVING',
  'UPSERT',
  'ON',
  'CONFLICT',
]);

const JS_KEYWORDS = new Set([
  'function',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'await',
  'async',
  'true',
  'false',
  'null',
]);

function highlightLine(line: string, language: 'sql' | 'javascript'): React.ReactNode[] {
  const tokenRegex = /('[^']*'|"[^"]*"|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("'") || token.startsWith('"')) {
      parts.push(
        <span key={keyIdx++} className="text-[#D97706]">
          {token}
        </span>
      );
    } else if (language === 'sql' && SQL_KEYWORDS.has(token.toUpperCase())) {
      parts.push(
        <span key={keyIdx++} className="text-[#4F46E5] font-medium">
          {token}
        </span>
      );
    } else if (language === 'javascript' && JS_KEYWORDS.has(token)) {
      parts.push(
        <span key={keyIdx++} className="text-[#4F46E5] font-medium">
          {token}
        </span>
      );
    } else if (/^\d/.test(token)) {
      parts.push(
        <span key={keyIdx++} className="text-[#059669]">
          {token}
        </span>
      );
    } else {
      parts.push(
        <span key={keyIdx++} className="text-[#334155]">
          {token}
        </span>
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [' '];
}

export function SyntaxCodeBlock({
  code,
  language,
  maxLines,
  compact = false,
}: SyntaxCodeBlockProps) {
  const allLines = (code || '').split('\n');
  const lines = maxLines ? allLines.slice(0, maxLines) : allLines;

  return (
    <div
      className={`font-mono-code overflow-hidden select-none ${
        compact ? 'text-[10.5px] leading-[1.45]' : 'text-[11.5px] leading-[1.55]'
      }`}
    >
      {lines.map((line, i) => (
        <div key={i} className="flex items-start gap-2.5 whitespace-pre overflow-hidden">
          <span className="w-3.5 shrink-0 text-right text-[#94A3B8] select-none">
            {i + 1}
          </span>
          <span className="truncate flex-1">{highlightLine(line, language)}</span>
        </div>
      ))}
    </div>
  );
}
