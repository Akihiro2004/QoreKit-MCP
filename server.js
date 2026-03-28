#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

// ─── Lazy imports (optional heavy deps) ─────────────────────────────────────

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

// ─── Tool Definitions ────────────────────────────────────────────────────────

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
];

// ─── Implementations ─────────────────────────────────────────────────────────

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

// Unit conversion: all values normalized to a common base per category
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

// ─── Request Handlers ────────────────────────────────────────────────────────

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
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: String(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
