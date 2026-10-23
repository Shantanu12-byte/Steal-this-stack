import fs from 'fs/promises';
import path from 'path';

/**
 * Analyzes the extracted StealThisStack payload and infers Full-Stack
 * Database Schemas, API Routes, and Stateful Components for REA.
 */
export function buildReaFullStackContract(pickedData) {
  const dom = pickedData.annotatedDomBlueprint || '';
  const sections = pickedData.pageSectionsSummary || [];

  // 1. Detect Auth & User Flows
  const hasAuth = /sign in|log in|join|register| sign up|become a seller/i.test(dom);

  // 2. Detect Search & Filtering Flows
  const hasSearch = /<form|<input|search/i.test(dom);

  // 3. Infer Database Entities from Repeating UI Cards & Sections
  const inferredModels = [];

  if (hasAuth) {
    inferredModels.push({
      modelName: 'User',
      fields: ['id: String @id @default(cuid())', 'email: String @unique', 'name: String?', 'role: String @default("USER")', 'avatarUrl: String?', 'createdAt: DateTime @default(now())']
    });
  }

  // Detect service/product/project cards
  if (/popular services|categories|gig|pricing|solutions|work|case study/i.test(dom)) {
    inferredModels.push({
      modelName: 'CatalogItem',
      fields: [
        'id: String @id @default(cuid())',
        'title: String',
        'slug: String @unique',
        'category: String',
        'description: String?',
        'imageUrl: String',
        'videoUrl: String?',
        'featured: Boolean @default(false)',
        'createdAt: DateTime @default(now())'
      ]
    });
  }

  if (/guide|article|blog|insight/i.test(dom)) {
    inferredModels.push({
      modelName: 'ArticlePost',
      fields: [
        'id: String @id @default(cuid())',
        'title: String',
        'coverImage: String',
        'summary: String?',
        'publishedAt: DateTime @default(now())'
      ]
    });
  }

  // Always include a Lead/Submission model for forms/CTAs
  inferredModels.push({
    modelName: 'InquiryLead',
    fields: [
      'id: String @id @default(cuid())',
      'email: String',
      'query: String?',
      'sourceSection: String?',
      'createdAt: DateTime @default(now())'
    ]
  });

  // 4. Infer Required Backend API Endpoints
  const apiEndpoints = [
    { method: 'GET', path: '/api/catalog', purpose: 'Fetch dynamic cards for carousels & grids (seeded with extracted media URLs)' },
    { method: 'GET', path: '/api/search', purpose: 'Query parameter search & category filter handler for the Hero search form' },
    { method: 'POST', path: '/api/inquiries', purpose: 'Handle CTA form submissions & lead capture' }
  ];

  if (hasAuth) {
    apiEndpoints.push({
      method: 'POST',
      path: '/api/auth/[...nextauth]',
      purpose: 'Authentication flow for Sign In / Join modal triggers'
    });
  }

  return {
    generator: 'StealThisStack-to-REA Bridge v1.0',
    targetUrl: pickedData.url,
    extractedAt: new Date().toISOString(),
    frontendSpec: {
      framework: 'Next.js 15 (App Router) + React 19 + Tailwind CSS',
      sectionsCount: sections.length,
      sectionsMap: sections,
      cssVariables: pickedData.resolvedVars,
      keyframesCount: pickedData.keyframes.length,
      mediaAssetsCount: pickedData.visibleMediaAssets.length
    },
    backendSpec: {
      orm: 'Prisma / Drizzle (PostgreSQL / SQLite)',
      features: {
        authentication: hasAuth,
        fullTextSearch: hasSearch,
        dynamicSeedData: true
      },
      inferredPrismaModels: inferredModels,
      apiRoutes: apiEndpoints,
      seedAssets: pickedData.visibleMediaAssets
    }
  };
}

/**
 * Generates the combined REA Full-Stack Master Prompt & JSON Manifest
 */
export async function exportReaWorkspace(pickedData, outputDir) {
  const reaContract = buildReaFullStackContract(pickedData);

  // 1. Save machine-readable JSON contract for REA CLI / automated pipelines
  const manifestPath = path.join(outputDir, 'rea-fullstack-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(reaContract, null, 2), 'utf-8');

  // 2. Build the REA Full-Stack Compiler Prompt
  const prismaSchemaText = reaContract.backendSpec.inferredPrismaModels
    .map((m) => `model ${m.modelName} {\n  ${m.fields.join('\n  ')}\n}`)
    .join('\n\n');

  const apiRoutesText = reaContract.backendSpec.apiRoutes
    .map((r) => `- \`${r.method} ${r.path}\` → ${r.purpose}`)
    .join('\n');

  const varEntries = Object.entries(pickedData.resolvedVars || {});
  const formattedVars = varEntries.length
    ? varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : '  /* Use computed RGB tokens from DOM blueprint */';

  const reaPrompt = [
    '# ⚡ REA × STEALTHISSTACK: FULL-STACK APPLICATION COMPILER',
    `Target Source: ${pickedData.url}`,
    `Architecture: Next.js (App Router) + Tailwind CSS + Prisma/SQLite + Server Actions / API Routes`,
    '',
    '## MISSION PROTOCOL:',
    'You are operating in **REA Full-Stack Mode**. StealThisStack has extracted the exact pixel-accurate UI, media assets, and motion keyframes from the target URL. Your job is to compile this into a **working, database-backed Full-Stack Application**.',
    '',
    '### 1. FRONTEND EXECUTION (STEALTHISSTACK UI LAYER):',
    '- Render every section listed in the Page Architecture Map with 1:1 visual fidelity.',
    '- Bind all extracted `@keyframes`, hover transitions, and exact Cloudinary/CDN media URLs.',
    '- Convert static repeating DOM cards (e.g. Services, Categories, Case Studies, Guides) into dynamic data-driven React Server/Client Components.',
    '',
    '### 2. BACKEND & DATABASE EXECUTION (REA ENGINE LAYER):',
    '- Implement the Prisma Schema below and create a `prisma/seed.ts` script that populates the database using the exact extracted image/video URLs and titles from Section 4.',
    '- Wire the Search Bar `<form>` and Category Pills to filter data dynamically via URL searchParams or `/api/search`.',
    '- Wire "Sign In" / "Join" / CTA buttons to working interactive modals and Server Actions.',
    '',
    '---',
    '## SECTION 1: INFERRED PRISMA DATABASE SCHEMA (`prisma/schema.prisma`)',
    '```prisma',
    prismaSchemaText,
    '```',
    '',
    '## SECTION 2: REQUIRED API ROUTES & SERVER ACTIONS',
    apiRoutesText,
    '',
    '## SECTION 3: PAGE ARCHITECTURE MAP',
    pickedData.pageSectionsSummary && pickedData.pageSectionsSummary.length
      ? pickedData.pageSectionsSummary.join('\n')
      : '1. Full Application Layout',
    '',
    '## SECTION 4: SEED DATA & MEDIA ASSETS (USE IN `prisma/seed.ts` & UI)',
    '```json',
    JSON.stringify(pickedData.visibleMediaAssets, null, 2),
    '```',
    '',
    '## SECTION 5: DESIGN TOKENS & @KEYFRAMES (`app/globals.css`)',
    '```css',
    ':root {\n' + formattedVars + '\n}\n',
    pickedData.keyframes.join('\n\n'),
    '```',
    '',
    '## SECTION 6: FULL DOM BLUEPRINT (CONVERT TO NEXT.JS COMPONENTS)',
    '```html',
    pickedData.annotatedDomBlueprint || '',
    '```'
  ].join('\n');

  const promptPath = path.join(outputDir, 'rea-fullstack-prompt.md');
  await fs.writeFile(promptPath, reaPrompt, 'utf-8');

  return { manifestPath, promptPath, reaPrompt, reaContract };
}