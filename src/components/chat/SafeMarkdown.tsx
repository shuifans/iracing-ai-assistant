'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

interface SafeMarkdownProps {
  children: string;
}

const SAFE_MARKDOWN_SCHEMA = {
  allowComments: false,
  allowDoctypes: false,
  tagNames: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: {
    a: ['href', 'title'],
    code: [['className', /^language-[\w-]+$/]],
    ol: ['start'],
    td: [['align', 'left', 'right', 'center']],
    th: [['align', 'left', 'right', 'center']],
  },
  protocols: {
    href: ['http', 'https'],
  },
};

const HTML_REFERENCE_PATTERN =
  /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|colon|gt|lt|NewLine|quot|sol|Tab));/gi;

const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  apos: "'",
  colon: ':',
  gt: '>',
  lt: '<',
  newline: '\n',
  quot: '"',
  sol: '/',
  tab: '\t',
};

function decodeUrlReferences(value: string): string {
  let decoded = value;

  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(
      HTML_REFERENCE_PATTERN,
      (
        _reference,
        decimal: string | undefined,
        hexadecimal: string | undefined,
        named: string | undefined,
      ) => {
        if (decimal || hexadecimal) {
          const codePoint = Number.parseInt(decimal ?? hexadecimal ?? '', decimal ? 10 : 16);
          if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '\uFFFD';

          try {
            return String.fromCodePoint(codePoint);
          } catch {
            return '\uFFFD';
          }
        }

        return NAMED_REFERENCES[named?.toLowerCase() ?? ''] ?? '';
      },
    );

    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

/**
 * Accept only HTTP(S) URLs and the relative forms the UI intentionally supports.
 * Any control character is rejected instead of normalized so it cannot hide a scheme.
 */
export function sanitizeMarkdownUrl(value: string): string | undefined {
  const decoded = decodeUrlReferences(value).trim();

  if (!decoded || /\s|[\u0000-\u001f\u007f-\u009f]/u.test(decoded) || decoded.includes('\\')) {
    return undefined;
  }

  if (/^https?:\/\//i.test(decoded)) {
    try {
      const url = new URL(decoded);
      return url.protocol === 'http:' || url.protocol === 'https:' ? decoded : undefined;
    } catch {
      return undefined;
    }
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//')) {
    return undefined;
  }

  // Root-relative, dot-relative, fragment, query, and plain relative Wiki paths.
  return decoded;
}

function SafeLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const safeHref = sanitizeMarkdownUrl(href ?? '');

  if (!safeHref) {
    return <span>{children}</span>;
  }

  const external = /^https?:\/\//i.test(safeHref);
  return (
    <a
      {...props}
      href={safeHref}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="break-words text-brand-600 underline hover:text-brand-800"
    >
      {children}
    </a>
  );
}

function Table({ children }: { children?: ReactNode }) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-300">{children}</table>
    </div>
  );
}

export function SafeMarkdown({ children }: SafeMarkdownProps) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, SAFE_MARKDOWN_SCHEMA]]}
      urlTransform={(url) => sanitizeMarkdownUrl(url)}
      components={{
        a: SafeLink,
        blockquote: ({ children: content }) => (
          <blockquote className="my-2 border-l-4 border-gray-300 pl-3 text-gray-600">
            {content}
          </blockquote>
        ),
        code: ({ children: content, className }) => (
          <code
            className={className ?? 'rounded bg-gray-100 px-1.5 py-0.5 text-[13px] text-red-600'}
          >
            {content}
          </code>
        ),
        h1: ({ children: content }) => (
          <h1 className="mb-1 mt-2.5 text-base font-semibold">{content}</h1>
        ),
        h2: ({ children: content }) => (
          <h2 className="mb-1 mt-2.5 text-[15px] font-semibold">{content}</h2>
        ),
        h3: ({ children: content }) => (
          <h3 className="mb-1 mt-2.5 text-sm font-semibold">{content}</h3>
        ),
        li: ({ children: content }) => <li className="ml-4 pl-0.5 leading-[1.65]">{content}</li>,
        ol: ({ children: content, start }) => (
          <ol className="my-1 list-decimal space-y-0.5" start={start}>
            {content}
          </ol>
        ),
        p: ({ children: content }) => <p className="my-1">{content}</p>,
        pre: ({ children: content }) => (
          <pre className="overflow-x-auto rounded-lg bg-navy-900 p-3 text-[13px] leading-5 text-gray-100">
            {content}
          </pre>
        ),
        table: Table,
        td: ({ children: content, align }) => (
          <td className="border border-gray-300 px-2.5 py-1.5 text-[13px]" align={align}>
            {content}
          </td>
        ),
        th: ({ children: content, align }) => (
          <th
            className="border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-left text-[13px] font-semibold"
            align={align}
          >
            {content}
          </th>
        ),
        ul: ({ children: content }) => <ul className="my-1 list-disc space-y-0.5">{content}</ul>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
