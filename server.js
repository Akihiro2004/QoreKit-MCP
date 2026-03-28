#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

let _sharp = null;
async function getSharp() {
  if (!_sharp) _sharp = (await import('sharp')).default;
  return _sharp;
}

let _qrcode = null;
async function getQrcode() {
  if (!_qrcode) _qrcode = (await import('qrcode')).default;
  return _qrcode;
}

let _pdfLib = null;
async function getPdfLib() {
  if (!_pdfLib) _pdfLib = await import('pdf-lib');
  return _pdfLib;
}

const server = new Server(
  { name: 'qorekit', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: 'base64_encode',
    description: 'Encode text to Base64',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to encode' },
      },
      required: ['text'],
    },
  },
  {
    name: 'base64_decode',
    description: 'Decode a Base64 string back to plain text',
    inputSchema: {
      type: 'object',
      properties: {
        encoded: { type: 'string', description: 'Base64 string to decode' },
      },
      required: ['encoded'],
    },
  },
  {
    name: 'hash_generate',
    description: 'Generate a cryptographic hash of text. Supported: md5, sha1, sha256, sha512',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to hash' },
        algorithm: {
          type: 'string',
          enum: ['md5', 'sha1', 'sha256', 'sha512'],
          description: 'Hash algorithm (default: sha256)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'json_format',
    description: 'Format, minify, or validate a JSON string',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'string', description: 'JSON string to process' },
        mode: {
          type: 'string',
          enum: ['format', 'minify', 'validate'],
          description: 'Operation mode (default: format)',
        },
        indent: { type: 'number', description: 'Indent spaces for format mode (default: 2)' },
      },
      required: ['json'],
    },
  },
  {
    name: 'url_encode',
    description: 'URL-encode or URL-decode a string using encodeURIComponent / decodeURIComponent',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to encode or decode' },
        mode: {
          type: 'string',
          enum: ['encode', 'decode'],
          description: 'encode or decode (default: encode)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'html_entity',
    description: 'Encode special characters to HTML entities or decode them back',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to process' },
        mode: {
          type: 'string',
          enum: ['encode', 'decode'],
          description: 'encode or decode (default: encode)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'number_base_convert',
    description: 'Convert a number between binary (2), octal (8), decimal (10), and hexadecimal (16)',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'The number value as a string' },
        from_base: { type: 'number', description: 'Source base: 2, 8, 10, or 16' },
        to_base: { type: 'number', description: 'Target base: 2, 8, 10, or 16' },
      },
      required: ['value', 'from_base', 'to_base'],
    },
  },
  {
    name: 'uuid_generate',
    description: 'Generate one or more random UUID v4 strings',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of UUIDs to generate (default: 1, max: 20)' },
      },
    },
  },
  {
    name: 'jwt_decode',
    description: 'Decode a JWT and inspect the header, payload, expiry, and issued-at fields',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'JWT token (three dot-separated Base64url segments)' },
      },
      required: ['token'],
    },
  },
  {
    name: 'regex_test',
    description: 'Test a regular expression against a string and return all matches with positions',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern (without delimiters)' },
        test_string: { type: 'string', description: 'String to test against' },
        flags: { type: 'string', description: 'Regex flags: g, i, m, s (default: g)' },
      },
      required: ['pattern', 'test_string'],
    },
  },
  {
    name: 'diff_text',
    description: 'Compare two blocks of text and show a line-by-line diff',
    inputSchema: {
      type: 'object',
      properties: {
        text1: { type: 'string', description: 'Original text' },
        text2: { type: 'string', description: 'Modified text' },
      },
      required: ['text1', 'text2'],
    },
  },
  {
    name: 'word_count',
    description: 'Count words, characters, lines, and sentences in text',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to analyze' },
      },
      required: ['text'],
    },
  },
  {
    name: 'text_transform',
    description: 'Transform text to uppercase, lowercase, titlecase, camelCase, snake_case, kebab-case, or CONSTANT_CASE',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to transform' },
        transform: {
          type: 'string',
          enum: ['uppercase', 'lowercase', 'titlecase', 'camelcase', 'snakecase', 'kebabcase', 'constantcase'],
          description: 'Transformation type',
        },
      },
      required: ['text', 'transform'],
    },
  },
  {
    name: 'lorem_ipsum',
    description: 'Generate Lorem Ipsum placeholder text (words, sentences, or paragraphs)',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'How many units to generate (default: 3)' },
        type: {
          type: 'string',
          enum: ['words', 'sentences', 'paragraphs'],
          description: 'Unit type (default: paragraphs)',
        },
      },
    },
  },
  {
    name: 'password_generate',
    description: 'Generate a cryptographically secure random password',
    inputSchema: {
      type: 'object',
      properties: {
        length: { type: 'number', description: 'Password length (default: 16)' },
        uppercase: { type: 'boolean', description: 'Include uppercase letters (default: true)' },
        lowercase: { type: 'boolean', description: 'Include lowercase letters (default: true)' },
        numbers: { type: 'boolean', description: 'Include numbers (default: true)' },
        symbols: { type: 'boolean', description: 'Include symbols like !@#$ (default: false)' },
        count: { type: 'number', description: 'Number of passwords to generate (default: 1, max: 10)' },
      },
    },
  },
  {
    name: 'bmi_calculate',
    description: 'Calculate BMI (Body Mass Index) and return the category',
    inputSchema: {
      type: 'object',
      properties: {
        weight: { type: 'number', description: 'Weight in kilograms' },
        height: { type: 'number', description: 'Height in meters (e.g. 1.75)' },
      },
      required: ['weight', 'height'],
    },
  },
  {
    name: 'age_calculate',
    description: 'Calculate exact age from a birth date',
    inputSchema: {
      type: 'object',
      properties: {
        birth_date: { type: 'string', description: 'Birth date in YYYY-MM-DD format' },
      },
      required: ['birth_date'],
    },
  },
  {
    name: 'loan_calculate',
    description: 'Calculate monthly payment and total cost for a loan',
    inputSchema: {
      type: 'object',
      properties: {
        principal: { type: 'number', description: 'Loan amount' },
        annual_rate: { type: 'number', description: 'Annual interest rate as a percentage (e.g. 5 for 5%)' },
        years: { type: 'number', description: 'Loan term in years' },
      },
      required: ['principal', 'annual_rate', 'years'],
    },
  },
  {
    name: 'bill_split',
    description: 'Split a bill evenly between people with an optional tip',
    inputSchema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Total bill amount' },
        people: { type: 'number', description: 'Number of people' },
        tip_percent: { type: 'number', description: 'Tip percentage (default: 0)' },
      },
      required: ['total', 'people'],
    },
  },
  {
    name: 'unit_convert',
    description: 'Convert values between units. Supports length (m, km, ft, mi, in), weight (g, kg, lb, oz), temperature (celsius, fahrenheit, kelvin), area (sqm, sqft, acre), volume (liter, gallon, cup), and speed (kmh, mph, knot)',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Value to convert' },
        from: { type: 'string', description: 'Source unit abbreviation' },
        to: { type: 'string', description: 'Target unit abbreviation' },
      },
      required: ['value', 'from', 'to'],
    },
  },
  {
    name: 'timestamp_convert',
    description: 'Convert between Unix timestamps, ISO 8601, and human-readable dates. Pass "now" for current time',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Unix timestamp (seconds), ISO date string, or "now"' },
      },
      required: ['value'],
    },
  },
  {
    name: 'color_convert',
    description: 'Convert a color between HEX, RGB, and HSL formats. Returns all three representations',
    inputSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: 'Color in any format: #RRGGBB, #RGB, rgb(r,g,b), or hsl(h,s%,l%)' },
      },
      required: ['color'],
    },
  },

  {
    name: 'image_info',
    description: 'Read metadata from an image file: format, dimensions, color space, file size, DPI',
    inputSchema: {
      type: 'object',
      properties: {
        input_path: { type: 'string', description: 'Absolute path to the image file' },
      },
      required: ['input_path'],
    },
  },
  {
    name: 'image_convert',
    description: 'Convert an image to a different format (jpeg, png, webp, avif, gif)',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source image' },
        format:      { type: 'string', enum: ['jpeg', 'png', 'webp', 'avif', 'gif'], description: 'Target format' },
        output_path: { type: 'string', description: 'Output file path (optional, defaults to same dir with new extension)' },
      },
      required: ['input_path', 'format'],
    },
  },
  {
    name: 'image_resize',
    description: 'Resize an image to a given width and/or height',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source image' },
        width:       { type: 'number', description: 'Target width in pixels (optional)' },
        height:      { type: 'number', description: 'Target height in pixels (optional)' },
        fit:         { type: 'string', enum: ['cover', 'contain', 'fill', 'inside', 'outside'], description: 'Resize fit strategy (default: cover)' },
        output_path: { type: 'string', description: 'Output file path (optional)' },
      },
      required: ['input_path'],
    },
  },
  {
    name: 'image_compress',
    description: 'Compress an image by reducing quality. Returns original vs compressed size',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source image' },
        quality:     { type: 'number', description: 'Quality 1-100 (default: 80)' },
        output_path: { type: 'string', description: 'Output file path (optional)' },
      },
      required: ['input_path'],
    },
  },
  {
    name: 'image_rotate',
    description: 'Rotate an image by a given angle in degrees',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source image' },
        angle:       { type: 'number', description: 'Rotation angle in degrees (e.g. 90, 180, 270)' },
        output_path: { type: 'string', description: 'Output file path (optional)' },
      },
      required: ['input_path', 'angle'],
    },
  },
  {
    name: 'image_crop',
    description: 'Crop a rectangular region from an image',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source image' },
        left:        { type: 'number', description: 'X offset from left edge in pixels' },
        top:         { type: 'number', description: 'Y offset from top edge in pixels' },
        width:       { type: 'number', description: 'Width of the crop region in pixels' },
        height:      { type: 'number', description: 'Height of the crop region in pixels' },
        output_path: { type: 'string', description: 'Output file path (optional)' },
      },
      required: ['input_path', 'left', 'top', 'width', 'height'],
    },
  },

  {
    name: 'qr_generate',
    description: 'Generate a QR code for any text or URL. If output_path is provided saves a file (SVG or PNG); otherwise returns the SVG markup directly',
    inputSchema: {
      type: 'object',
      properties: {
        text:        { type: 'string', description: 'Text or URL to encode' },
        output_path: { type: 'string', description: 'Optional file path to save. Use .svg or .png extension' },
        error_level: { type: 'string', enum: ['L', 'M', 'Q', 'H'], description: 'Error correction level (default: M)' },
      },
      required: ['text'],
    },
  },

  {
    name: 'pdf_merge',
    description: 'Merge multiple PDF files into a single PDF',
    inputSchema: {
      type: 'object',
      properties: {
        input_paths: { type: 'array', items: { type: 'string' }, description: 'Array of absolute paths to PDF files (in order)' },
        output_path: { type: 'string', description: 'Absolute path for the merged output PDF' },
      },
      required: ['input_paths', 'output_path'],
    },
  },
  {
    name: 'pdf_watermark',
    description: 'Add a diagonal text watermark to every page of a PDF',
    inputSchema: {
      type: 'object',
      properties: {
        input_path:  { type: 'string', description: 'Absolute path to the source PDF' },
        text:        { type: 'string', description: 'Watermark text (e.g. "CONFIDENTIAL")' },
        output_path: { type: 'string', description: 'Output file path (optional)' },
        opacity:     { type: 'number', description: 'Watermark opacity 0-1 (default: 0.3)' },
      },
      required: ['input_path', 'text'],
    },
  },

  {
    name: 'image_to_pdf',
    description: 'Convert one or more images (JPEG, PNG, WebP, etc.) into a single PDF file, one image per page',
    inputSchema: {
      type: 'object',
      properties: {
        input_paths: { type: 'array', items: { type: 'string' }, description: 'Array of absolute image file paths (in order)' },
        output_path: { type: 'string', description: 'Absolute path for the output PDF (optional)' },
      },
      required: ['input_paths'],
    },
  },

  {
    name: 'css_gradient',
    description: 'Generate a CSS gradient string (linear, radial, or conic) from a list of colors',
    inputSchema: {
      type: 'object',
      properties: {
        colors: { type: 'array', items: { type: 'string' }, description: 'Array of color values (hex, rgb, hsl, or named)' },
        type:   { type: 'string', enum: ['linear', 'radial', 'conic'], description: 'Gradient type (default: linear)' },
        angle:  { type: 'number', description: 'Angle in degrees for linear/conic gradients (default: 135)' },
      },
      required: ['colors'],
    },
  },
  {
    name: 'css_box_shadow',
    description: 'Generate a CSS box-shadow declaration. Supports multiple layers for depth effects',
    inputSchema: {
      type: 'object',
      properties: {
        x:      { type: 'number', description: 'Horizontal offset in px (default: 0)' },
        y:      { type: 'number', description: 'Vertical offset in px (default: 4)' },
        blur:   { type: 'number', description: 'Blur radius in px (default: 16)' },
        spread: { type: 'number', description: 'Spread radius in px (default: 0)' },
        color:  { type: 'string', description: 'Shadow color (default: rgba(0,0,0,0.15))' },
        inset:  { type: 'boolean', description: 'Inner shadow (default: false)' },
        layers: { type: 'number', description: 'Number of stacked shadow layers for depth (default: 1, max: 4)' },
      },
    },
  },
  {
    name: 'color_palette_generate',
    description: 'Generate a color palette from a base hex color using a color theory scheme',
    inputSchema: {
      type: 'object',
      properties: {
        base_color: { type: 'string', description: 'Base color in #RRGGBB format' },
        scheme:     { type: 'string', enum: ['complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic', 'monochromatic'], description: 'Color harmony scheme (default: complementary)' },
        count:      { type: 'number', description: 'Number of colors to return (default: 5, max: 10)' },
      },
      required: ['base_color'],
    },
  },
];


function base64Encode(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function base64Decode(encoded) {
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function hashGenerate(text, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(text).digest('hex');
}

function jsonFormat(jsonStr, mode = 'format', indent = 2) {
  const parsed = JSON.parse(jsonStr);
  if (mode === 'validate') return `Valid JSON - ${typeof parsed === 'object' && parsed !== null ? (Array.isArray(parsed) ? `array with ${parsed.length} items` : `object with ${Object.keys(parsed).length} keys`) : typeof parsed}`;
  if (mode === 'minify') return JSON.stringify(parsed);
  return JSON.stringify(parsed, null, indent);
}

function urlProcess(text, mode = 'encode') {
  return mode === 'encode' ? encodeURIComponent(text) : decodeURIComponent(text);
}

function htmlEntity(text, mode = 'encode') {
  if (mode === 'encode') {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function numberBaseConvert(value, fromBase, toBase) {
  const decimal = parseInt(String(value), fromBase);
  if (isNaN(decimal)) throw new Error(`"${value}" is not a valid base-${fromBase} number`);
  const result = decimal.toString(toBase).toUpperCase();
  const labels = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hex' };
  return `${value} (base ${fromBase} / ${labels[fromBase] || ''}) = ${result} (base ${toBase} / ${labels[toBase] || ''})`;
}

function uuidGenerate(count = 1) {
  const n = Math.min(Math.max(1, Number(count)), 20);
  return Array.from({ length: n }, () => crypto.randomUUID()).join('\n');
}

function jwtDecode(token) {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT - expected 3 dot-separated segments');
  const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  const meta = {};
  if (payload.exp) {
    meta.expired    = payload.exp < now;
    meta.expires_at = new Date(payload.exp * 1000).toISOString();
    meta.expires_in = payload.exp >= now ? `${payload.exp - now}s` : `expired ${now - payload.exp}s ago`;
  }
  if (payload.iat) meta.issued_at = new Date(payload.iat * 1000).toISOString();
  return JSON.stringify({ header, payload, meta }, null, 2);
}

function regexTest(pattern, testString, flags = 'g') {
  const safeFlags = flags.includes('g') ? flags : flags + 'g';
  const regex = new RegExp(pattern, safeFlags);
  const matches = [];
  let match;
  while ((match = regex.exec(testString)) !== null) {
    matches.push({
      match:  match[0],
      index:  match.index,
      end:    match.index + match[0].length,
      groups: match.groups ?? null,
    });
  }
  const lines = [
    `Pattern: /${pattern}/${flags}`,
    `Test string length: ${testString.length} chars`,
    `Matches found: ${matches.length}`,
  ];
  if (matches.length > 0) {
    lines.push('');
    matches.forEach((m, i) => {
      lines.push(`Match ${i + 1}: "${m.match}" at index ${m.index}-${m.end}`);
      if (m.groups) lines.push(`  Groups: ${JSON.stringify(m.groups)}`);
    });
  }
  return lines.join('\n');
}

function diffText(text1, text2) {
  const lines1 = text1.split('\n');
  const lines2 = text2.split('\n');
  const result = [];
  const maxLen = Math.max(lines1.length, lines2.length);
  let added = 0, removed = 0, unchanged = 0;
  for (let i = 0; i < maxLen; i++) {
    const a = lines1[i];
    const b = lines2[i];
    if (a === undefined) {
      result.push(`+ ${b}`); added++;
    } else if (b === undefined) {
      result.push(`- ${a}`); removed++;
    } else if (a === b) {
      result.push(`  ${a}`); unchanged++;
    } else {
      result.push(`- ${a}`); result.push(`+ ${b}`); removed++; added++;
    }
  }
  return [`--- original`, `+++ modified`, `@@ summary: +${added} -${removed} =${unchanged} @@`, '', ...result].join('\n');
}

function wordCount(text) {
  const words     = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars     = text.length;
  const noSpaces  = text.replace(/\s/g, '').length;
  const lines     = text.split('\n').length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
  const readMins  = Math.ceil(words / 200);
  return [
    `Words:                ${words}`,
    `Characters:           ${chars}`,
    `Characters (no space):${noSpaces}`,
    `Lines:                ${lines}`,
    `Sentences:            ${sentences}`,
    `Reading time:         ~${readMins} min`,
  ].join('\n');
}

function textTransform(text, transform) {
  switch (transform) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'titlecase':
      return text.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    case 'camelcase': {
      const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
      return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('');
    }
    case 'snakecase':
      return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    case 'kebabcase':
      return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    case 'constantcase':
      return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    default:
      throw new Error(`Unknown transform: ${transform}`);
  }
}

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'reprehenderit', 'voluptate', 'velit',
  'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat',
  'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
  'mollit', 'anim', 'est', 'laborum',
];

function loremIpsum(count = 3, type = 'paragraphs') {
  const w = (offset, len) => Array.from({ length: len }, (_, i) => LOREM_WORDS[(offset + i) % LOREM_WORDS.length]);
  const sentence = (offset, len) => {
    const words = w(offset, len);
    return words[0][0].toUpperCase() + words[0].slice(1) + ' ' + words.slice(1).join(' ') + '.';
  };

  if (type === 'words') {
    return w(0, Math.min(count, 200)).join(' ');
  }
  if (type === 'sentences') {
    return Array.from({ length: count }, (_, i) => sentence(i * 12, 8 + (i % 6))).join(' ');
  }
  return Array.from({ length: count }, (_, i) => {
    const sentCount = 4 + (i % 3);
    return Array.from({ length: sentCount }, (_, s) => sentence(i * 60 + s * 12, 10 + (s % 7))).join(' ');
  }).join('\n\n');
}

function passwordGenerate({ length = 16, uppercase = true, lowercase = true, numbers = true, symbols = false, count = 1 } = {}) {
  let charset = '';
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (numbers)   charset += '0123456789';
  if (symbols)   charset += '!@#$%^&*()-_=+[]{}|;:,.<>?';
  if (!charset)  throw new Error('Select at least one character type');
  const n = Math.min(Math.max(1, Number(count)), 10);
  const len = Math.min(Math.max(4, Number(length)), 128);
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(len);
    return Array.from(bytes, b => charset[b % charset.length]).join('');
  }).join('\n');
}

function bmiCalculate(weight, height) {
  if (height <= 0) throw new Error('Height must be greater than 0');
  const bmi = weight / (height * height);
  let category;
  if      (bmi < 18.5) category = 'Underweight';
  else if (bmi < 25.0) category = 'Normal weight';
  else if (bmi < 30.0) category = 'Overweight';
  else                  category = 'Obese';
  return [`BMI: ${bmi.toFixed(2)}`, `Category: ${category}`, `Weight: ${weight} kg`, `Height: ${height} m`].join('\n');
}

function ageCalculate(birthDate) {
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) throw new Error('Invalid date. Use YYYY-MM-DD format');
  const now = new Date();
  let years  = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth()    - birth.getMonth();
  let days   = now.getDate()     - birth.getDate();
  if (days   < 0) { months--; days   += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (months < 0) { years--;  months += 12; }
  const totalDays = Math.floor((now - birth) / 86400000);
  return [
    `Age: ${years} years, ${months} months, ${days} days`,
    `Total days: ${totalDays.toLocaleString()}`,
    `Born: ${birth.toDateString()}`,
    `Today: ${now.toDateString()}`,
  ].join('\n');
}

function loanCalculate(principal, annualRate, years) {
  const n = years * 12;
  let monthly, total, interest;
  if (annualRate === 0) {
    monthly  = principal / n;
    total    = principal;
    interest = 0;
  } else {
    const r  = annualRate / 100 / 12;
    monthly  = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    total    = monthly * n;
    interest = total - principal;
  }
  const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `Principal:       ${fmt(principal)}`,
    `Rate:            ${annualRate}% per year`,
    `Term:            ${years} years (${n} payments)`,
    `Monthly payment: ${fmt(monthly)}`,
    `Total payment:   ${fmt(total)}`,
    `Total interest:  ${fmt(interest)}`,
  ].join('\n');
}

function billSplit(total, people, tipPercent = 0) {
  const tip        = total * (tipPercent / 100);
  const grandTotal = total + tip;
  const perPerson  = grandTotal / people;
  const fmt = v => v.toFixed(2);
  return [
    `Subtotal:    ${fmt(total)}`,
    `Tip (${tipPercent}%): ${fmt(tip)}`,
    `Grand total: ${fmt(grandTotal)}`,
    `Per person:  ${fmt(perPerson)} (${people} people)`,
  ].join('\n');
}

const UNIT_MAP = {
  // Length (base: meters)
  mm: 0.001, cm: 0.01, m: 1, km: 1000,
  in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nm: 1e-9,
  // Weight (base: grams)
  mg: 0.001, g: 1, kg: 1000, t: 1e6,
  oz: 28.3495, lb: 453.592,
  // Area (base: sq meters)
  sqcm: 0.0001, sqm: 1, sqkm: 1e6, ha: 10000,
  sqin: 6.4516e-4, sqft: 0.092903, sqyd: 0.836127, sqmi: 2589988.1, acre: 4046.86,
  // Volume (base: liters)
  ml: 0.001, cl: 0.01, dl: 0.1, l: 1, liter: 1, litre: 1, cubicm: 1000,
  tsp: 0.00492892, tbsp: 0.0147868, floz: 0.0295735,
  cup: 0.236588, pint: 0.473176, quart: 0.946353, gallon: 3.78541,
  // Speed (base: m/s)
  ms: 1, kmh: 0.277778, mph: 0.44704, knot: 0.514444, fps: 0.3048,
  // Data (base: bytes)
  b: 0.125, byte: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776,
  kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776,
};

const TEMP_UNITS = ['celsius', 'fahrenheit', 'kelvin', 'c', 'f', 'k'];

function unitConvert(value, from, to) {
  const f = from.toLowerCase().replace(/\s+/g, '');
  const t = to.toLowerCase().replace(/\s+/g, '');

  if (TEMP_UNITS.includes(f) || TEMP_UNITS.includes(t)) {
    let celsius;
    if      (f === 'celsius'    || f === 'c') celsius = value;
    else if (f === 'fahrenheit' || f === 'f') celsius = (value - 32) * 5 / 9;
    else                                       celsius = value - 273.15;
    let result;
    if      (t === 'celsius'    || t === 'c') result = celsius;
    else if (t === 'fahrenheit' || t === 'f') result = celsius * 9 / 5 + 32;
    else                                       result = celsius + 273.15;
    return `${value} ${from} = ${result.toFixed(6)} ${to}`;
  }

  if (!UNIT_MAP[f] || !UNIT_MAP[t]) {
    const available = Object.keys(UNIT_MAP).sort().join(', ');
    throw new Error(`Unknown unit "${from}" or "${to}".\nAvailable units: ${available}`);
  }
  const result = value * UNIT_MAP[f] / UNIT_MAP[t];
  return `${value} ${from} = ${result.toFixed(8).replace(/\.?0+$/, '')} ${to}`;
}

function timestampConvert(value) {
  let date;
  if (value === 'now') {
    date = new Date();
  } else if (/^\d{10}$/.test(value.trim())) {
    date = new Date(parseInt(value) * 1000);
  } else if (/^\d{13}$/.test(value.trim())) {
    date = new Date(parseInt(value));
  } else {
    date = new Date(value);
  }
  if (isNaN(date.getTime())) throw new Error('Invalid date or timestamp. Use Unix seconds, Unix ms, ISO 8601, or "now"');
  return [
    `Unix (seconds):      ${Math.floor(date.getTime() / 1000)}`,
    `Unix (milliseconds): ${date.getTime()}`,
    `ISO 8601:            ${date.toISOString()}`,
    `UTC:                 ${date.toUTCString()}`,
    `Local:               ${date.toLocaleString()}`,
  ].join('\n');
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full  = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2;               break;
      case b: h = (r - g) / d + 4;               break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function colorConvert(color) {
  let r, g, b;
  const c = color.trim();
  if (c.startsWith('#')) {
    ({ r, g, b } = hexToRgb(c));
  } else if (c.startsWith('rgb')) {
    const nums = c.match(/[\d.]+/g);
    if (!nums || nums.length < 3) throw new Error('Invalid rgb() format');
    [r, g, b] = nums.map(Number);
  } else if (c.startsWith('hsl')) {
    const nums = c.match(/[\d.]+/g);
    if (!nums || nums.length < 3) throw new Error('Invalid hsl() format');
    const [h, s, l] = nums.map(Number);
    const sv = s / 100, lv = l / 100;
    const ch = (1 - Math.abs(2 * lv - 1)) * sv;
    const x  = ch * (1 - Math.abs((h / 60) % 2 - 1));
    const m  = lv - ch / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if      (h < 60)  [r1, g1, b1] = [ch, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, ch, 0];
    else if (h < 180) [r1, g1, b1] = [0, ch, x];
    else if (h < 240) [r1, g1, b1] = [0, x, ch];
    else if (h < 300) [r1, g1, b1] = [x, 0, ch];
    else               [r1, g1, b1] = [ch, 0, x];
    r = Math.round((r1 + m) * 255);
    g = Math.round((g1 + m) * 255);
    b = Math.round((b1 + m) * 255);
  } else {
    throw new Error('Unsupported color format. Use #RRGGBB, rgb(r,g,b), or hsl(h,s%,l%)');
  }
  const hex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const { h, s, l } = rgbToHsl(r, g, b);
  return [`HEX: ${hex}`, `RGB: rgb(${r}, ${g}, ${b})`, `HSL: hsl(${h}, ${s}%, ${l}%)`].join('\n');
}


function buildOutputPath(inputPath, newExt) {
  const dir  = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}_output.${newExt}`);
}

async function imageInfo(inputPath) {
  const sharp = await getSharp();
  const meta  = await sharp(inputPath).metadata();
  const stat  = await fs.stat(inputPath);
  return [
    `File:        ${inputPath}`,
    `Format:      ${meta.format}`,
    `Dimensions:  ${meta.width} x ${meta.height} px`,
    `Channels:    ${meta.channels}`,
    `Color space: ${meta.space || 'unknown'}`,
    `Has alpha:   ${meta.hasAlpha}`,
    `File size:   ${(stat.size / 1024).toFixed(2)} KB`,
    meta.density ? `DPI:         ${meta.density}` : null,
  ].filter(Boolean).join('\n');
}

async function imageConvert(inputPath, format, outputPath) {
  const sharp   = await getSharp();
  const outPath = outputPath || buildOutputPath(inputPath, format);
  await sharp(inputPath).toFormat(format).toFile(outPath);
  const stat = await fs.stat(outPath);
  return `Converted to ${format}: ${outPath}\nSize: ${(stat.size / 1024).toFixed(2)} KB`;
}

async function imageResize(inputPath, width, height, fit = 'cover', outputPath) {
  const sharp   = await getSharp();
  const ext     = path.extname(inputPath).slice(1) || 'jpg';
  const outPath = outputPath || buildOutputPath(inputPath, ext);
  const opts    = { fit };
  if (width)  opts.width  = width;
  if (height) opts.height = height;
  await sharp(inputPath).resize(opts).toFile(outPath);
  const meta = await sharp(outPath).metadata();
  return `Resized: ${outPath}\nNew dimensions: ${meta.width} x ${meta.height} px`;
}

async function imageCompress(inputPath, quality = 80, outputPath) {
  const sharp   = await getSharp();
  const ext     = path.extname(inputPath).toLowerCase().slice(1);
  const outPath = outputPath || buildOutputPath(inputPath, ext || 'jpg');
  const img     = sharp(inputPath);
  const q       = Math.min(100, Math.max(1, quality));
  if      (ext === 'png')              await img.png({ quality: q }).toFile(outPath);
  else if (ext === 'webp')             await img.webp({ quality: q }).toFile(outPath);
  else if (ext === 'avif')             await img.avif({ quality: q }).toFile(outPath);
  else                                 await img.jpeg({ quality: q }).toFile(outPath);
  const origStat = await fs.stat(inputPath);
  const newStat  = await fs.stat(outPath);
  const saved    = ((1 - newStat.size / origStat.size) * 100).toFixed(1);
  return [
    `Compressed: ${outPath}`,
    `Original:   ${(origStat.size / 1024).toFixed(2)} KB`,
    `Output:     ${(newStat.size  / 1024).toFixed(2)} KB`,
    `Saved:      ${saved}%`,
  ].join('\n');
}

async function imageRotate(inputPath, angle, outputPath) {
  const sharp   = await getSharp();
  const ext     = path.extname(inputPath).slice(1) || 'jpg';
  const outPath = outputPath || buildOutputPath(inputPath, ext);
  await sharp(inputPath).rotate(angle).toFile(outPath);
  return `Rotated ${angle}deg: ${outPath}`;
}

async function imageCrop(inputPath, left, top, cropWidth, cropHeight, outputPath) {
  const sharp   = await getSharp();
  const ext     = path.extname(inputPath).slice(1) || 'jpg';
  const outPath = outputPath || buildOutputPath(inputPath, ext);
  await sharp(inputPath).extract({ left, top, width: cropWidth, height: cropHeight }).toFile(outPath);
  return `Cropped: ${outPath}\nRegion: ${cropWidth} x ${cropHeight} at (${left}, ${top})`;
}

async function qrGenerate(text, outputPath, errorLevel = 'M') {
  const QRCode = await getQrcode();
  if (outputPath) {
    if (outputPath.toLowerCase().endsWith('.svg')) {
      const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: errorLevel });
      await fs.writeFile(outputPath, svg, 'utf8');
    } else {
      await QRCode.toFile(outputPath, text, { errorCorrectionLevel: errorLevel });
    }
    return `QR code saved: ${outputPath}`;
  }
  return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: errorLevel });
}

async function pdfMerge(inputPaths, outputPath) {
  const { PDFDocument } = await getPdfLib();
  const merged = await PDFDocument.create();
  for (const filePath of inputPaths) {
    const bytes = await fs.readFile(filePath);
    const doc   = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  const outBytes = await merged.save();
  await fs.writeFile(outputPath, outBytes);
  const stat = await fs.stat(outputPath);
  return [
    `Merged ${inputPaths.length} PDFs: ${outputPath}`,
    `Total pages: ${merged.getPageCount()}`,
    `Size: ${(stat.size / 1024).toFixed(2)} KB`,
  ].join('\n');
}

async function pdfWatermark(inputPath, text, outputPath, opacity = 0.3) {
  const { PDFDocument, rgb, degrees } = await getPdfLib();
  const bytes  = await fs.readFile(inputPath);
  const doc    = await PDFDocument.load(bytes);
  const pages  = doc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x:       width  / 2 - text.length * 6,
      y:       height / 2,
      size:    48,
      color:   rgb(0.5, 0.5, 0.5),
      opacity: Math.min(1, Math.max(0, opacity)),
      rotate:  degrees(45),
    });
  }
  const outPath  = outputPath || buildOutputPath(inputPath, 'pdf');
  const outBytes = await doc.save();
  await fs.writeFile(outPath, outBytes);
  return `Watermarked ${pages.length} page(s): ${outPath}`;
}

function cssGradient(colors, type = 'linear', angle = 135) {
  const stops = colors.join(', ');
  if      (type === 'linear') return `background: linear-gradient(${angle}deg, ${stops});`;
  else if (type === 'radial') return `background: radial-gradient(circle, ${stops});`;
  else if (type === 'conic')  return `background: conic-gradient(from ${angle}deg, ${stops});`;
  throw new Error(`Unknown gradient type: ${type}. Use linear, radial, or conic.`);
}

function cssBoxShadow({ x = 0, y = 4, blur = 16, spread = 0, color = 'rgba(0,0,0,0.15)', inset = false, layers = 1 } = {}) {
  const n      = Math.min(Math.max(1, layers), 4);
  const prefix = inset ? 'inset ' : '';
  const parts  = Array.from({ length: n }, (_, i) => {
    const scale = 1 + i * 0.8;
    return `${prefix}${x}px ${Math.round(y * scale)}px ${Math.round(blur * scale)}px ${spread}px ${color}`;
  });
  return `box-shadow: ${parts.join(',\n             ')};`;
}

function colorPaletteGenerate(baseColor, scheme = 'complementary', count = 5) {
  const hex  = baseColor.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  const r    = parseInt(full.slice(0, 2), 16);
  const g    = parseInt(full.slice(2, 4), 16);
  const b    = parseInt(full.slice(4, 6), 16);
  const { h, s, l } = rgbToHsl(r, g, b);
  const n = Math.min(Math.max(1, count), 10);

  let hues;
  switch (scheme) {
    case 'complementary':      hues = [h, (h + 180) % 360]; break;
    case 'analogous':          hues = [h, (h + 30) % 360, (h + 60) % 360, (h + 330) % 360, (h + 300) % 360]; break;
    case 'triadic':            hues = [h, (h + 120) % 360, (h + 240) % 360]; break;
    case 'split-complementary':hues = [h, (h + 150) % 360, (h + 210) % 360]; break;
    case 'tetradic':           hues = [h, (h + 90) % 360, (h + 180) % 360, (h + 270) % 360]; break;
    case 'monochromatic':      hues = Array.from({ length: n }, () => h); break;
    default: throw new Error(`Unknown scheme: ${scheme}`);
  }

  const palette = [];
  if (scheme === 'monochromatic') {
    for (let i = 0; i < n; i++) {
      const newL = Math.round(20 + (i / Math.max(n - 1, 1)) * 60);
      palette.push(`hsl(${h}, ${s}%, ${newL}%)`);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const hue  = hues[i % hues.length];
      const newL = i < hues.length ? l : Math.max(10, Math.min(90, l - 15 + (i * 10)));
      palette.push(`hsl(${hue}, ${s}%, ${newL}%)`);
    }
  }

  return [`Scheme: ${scheme}`, `Base: hsl(${h}, ${s}%, ${l}%)`, '', ...palette.map((c, i) => `${i + 1}. ${c}`)].join('\n');
}

async function imageToPdf(inputPaths, outputPath) {
  const { PDFDocument } = await getPdfLib();
  const sharp = await getSharp();
  const doc = await PDFDocument.create();
  for (const imgPath of inputPaths) {
    const ext = path.extname(imgPath).toLowerCase().slice(1);
    let imgBytes, embedded;
    if (ext === 'png') {
      imgBytes = await sharp(imgPath).png().toBuffer();
      embedded = await doc.embedPng(imgBytes);
    } else {
      imgBytes = await sharp(imgPath).jpeg().toBuffer();
      embedded = await doc.embedJpg(imgBytes);
    }
    const { width, height } = embedded.scale(1);
    const page = doc.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }
  const outPath = outputPath || buildOutputPath(inputPaths[0], 'pdf');
  const bytes = await doc.save();
  await fs.writeFile(outPath, bytes);
  const stat = await fs.stat(outPath);
  return [
    `Converted ${inputPaths.length} image(s) to PDF: ${outPath}`,
    `Pages: ${doc.getPageCount()}`,
    `Size: ${(stat.size / 1024).toFixed(2)} KB`,
  ].join('\n');
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result;
    switch (name) {
      case 'base64_encode':       result = base64Encode(args.text);                                                break;
      case 'base64_decode':       result = base64Decode(args.encoded);                                            break;
      case 'hash_generate':       result = hashGenerate(args.text, args.algorithm);                               break;
      case 'json_format':         result = jsonFormat(args.json, args.mode, args.indent);                         break;
      case 'url_encode':          result = urlProcess(args.text, args.mode);                                      break;
      case 'html_entity':         result = htmlEntity(args.text, args.mode);                                      break;
      case 'number_base_convert': result = numberBaseConvert(args.value, args.from_base, args.to_base);           break;
      case 'uuid_generate':       result = uuidGenerate(args.count);                                              break;
      case 'jwt_decode':          result = jwtDecode(args.token);                                                 break;
      case 'regex_test':          result = regexTest(args.pattern, args.test_string, args.flags);                 break;
      case 'diff_text':           result = diffText(args.text1, args.text2);                                      break;
      case 'word_count':          result = wordCount(args.text);                                                  break;
      case 'text_transform':      result = textTransform(args.text, args.transform);                              break;
      case 'lorem_ipsum':         result = loremIpsum(args.count, args.type);                                     break;
      case 'password_generate':   result = passwordGenerate(args);                                                break;
      case 'bmi_calculate':       result = bmiCalculate(args.weight, args.height);                               break;
      case 'age_calculate':       result = ageCalculate(args.birth_date);                                         break;
      case 'loan_calculate':      result = loanCalculate(args.principal, args.annual_rate, args.years);           break;
      case 'bill_split':          result = billSplit(args.total, args.people, args.tip_percent);                  break;
      case 'unit_convert':        result = unitConvert(args.value, args.from, args.to);                           break;
      case 'timestamp_convert':   result = timestampConvert(args.value);                                          break;
      case 'color_convert':       result = colorConvert(args.color);                                              break;

      // Image
      case 'image_info':          result = await imageInfo(args.input_path);                                      break;
      case 'image_convert':       result = await imageConvert(args.input_path, args.format, args.output_path);    break;
      case 'image_resize':        result = await imageResize(args.input_path, args.width, args.height, args.fit, args.output_path); break;
      case 'image_compress':      result = await imageCompress(args.input_path, args.quality, args.output_path);  break;
      case 'image_rotate':        result = await imageRotate(args.input_path, args.angle, args.output_path);      break;
      case 'image_crop':          result = await imageCrop(args.input_path, args.left, args.top, args.width, args.height, args.output_path); break;

      // QR code
      case 'qr_generate':         result = await qrGenerate(args.text, args.output_path, args.error_level);       break;

      // PDF
      case 'pdf_merge':           result = await pdfMerge(args.input_paths, args.output_path);                    break;
      case 'pdf_watermark':       result = await pdfWatermark(args.input_path, args.text, args.output_path, args.opacity); break;
      case 'image_to_pdf':        result = await imageToPdf(args.input_paths, args.output_path);                  break;

      // Design / CSS
      case 'css_gradient':        result = cssGradient(args.colors, args.type, args.angle);                       break;
      case 'css_box_shadow':      result = cssBoxShadow(args);                                                    break;
      case 'color_palette_generate': result = colorPaletteGenerate(args.base_color, args.scheme, args.count);     break;

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: String(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
