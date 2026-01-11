/**
 * Post-build script to generate pre-rendered HTML for blog routes
 *
 * This enables proper OG tags for social media crawlers on GitHub Pages.
 * Crawlers don't execute JavaScript, so we need static HTML with meta tags.
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://nikkdev.com';

interface BlogMeta {
  slug: string;
  title: string;
  description: string;
  image: string;
}

// Extract meta from markdown content (same logic as BlogPost.tsx)
function extractBlogMeta(content: string, slug: string): BlogMeta {
  // Extract title from first h1
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : slug;

  // Extract description from first paragraph
  const lines = content.split('\n');
  let description = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') &&
        !trimmed.startsWith('-') && !trimmed.startsWith('|') &&
        !trimmed.startsWith('<') && !trimmed.startsWith('*')) {
      description = trimmed.slice(0, 160);
      break;
    }
  }

  // Extract first image (markdown or HTML img tag)
  const imageMatch = content.match(/!\[.*?\]\((.+?)\)/) ||
                     content.match(/<img[^>]+src=["']([^"']+)["']/i);
  const image = imageMatch ? imageMatch[1] : '/og-default.png';

  return { slug, title, description, image };
}

// Generate HTML with proper OG tags
function generateBlogHtml(templateHtml: string, meta: BlogMeta): string {
  const pageUrl = `${BASE_URL}/blog/${meta.slug}`;
  const imageUrl = meta.image.startsWith('http') ? meta.image : `${BASE_URL}${meta.image}`;
  const pageTitle = `${meta.title} | Nikk Terminal`;

  let html = templateHtml;

  // Replace title
  html = html.replace(
    /<title>.*?<\/title>/,
    `<title>${pageTitle}</title>`
  );

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${meta.description}"`
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:title" content="[^"]*"/,
    `<meta property="og:title" content="${meta.title}"`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${meta.description}"`
  );
  html = html.replace(
    /<meta property="og:image" content="[^"]*"/,
    `<meta property="og:image" content="${imageUrl}"`
  );
  html = html.replace(
    /<meta property="og:type" content="[^"]*"/,
    `<meta property="og:type" content="article"`
  );

  // Add og:url if not present, or replace it
  if (html.includes('og:url')) {
    html = html.replace(
      /<meta property="og:url" content="[^"]*"/,
      `<meta property="og:url" content="${pageUrl}"`
    );
  } else {
    html = html.replace(
      /<meta property="og:type"/,
      `<meta property="og:url" content="${pageUrl}" />\n    <meta property="og:type"`
    );
  }

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"/,
    `<meta name="twitter:title" content="${meta.title}"`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"/,
    `<meta name="twitter:description" content="${meta.description}"`
  );
  html = html.replace(
    /<meta name="twitter:image" content="[^"]*"/,
    `<meta name="twitter:image" content="${imageUrl}"`
  );

  return html;
}

function main() {
  console.log('Generating pre-rendered blog pages...');

  const distDir = path.join(process.cwd(), 'dist');
  const blogDir = path.join(process.cwd(), 'public/terminal/blog');
  const templatePath = path.join(distDir, 'index.html');

  // Check if dist exists (build must run first)
  if (!fs.existsSync(templatePath)) {
    console.error('Error: dist/index.html not found. Run build first.');
    process.exit(1);
  }

  const templateHtml = fs.readFileSync(templatePath, 'utf-8');

  // Check if blog directory exists
  if (!fs.existsSync(blogDir)) {
    console.log('No blog directory found, skipping.');
    return;
  }

  // Get all blog posts
  const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.md'));
  console.log(`Found ${blogFiles.length} blog posts`);

  for (const file of blogFiles) {
    const slug = file.replace('.md', '');
    const content = fs.readFileSync(path.join(blogDir, file), 'utf-8');
    const meta = extractBlogMeta(content, slug);

    // Generate HTML with proper OG tags
    const html = generateBlogHtml(templateHtml, meta);

    // Create directory and write file
    const outputDir = path.join(distDir, 'blog', slug);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'index.html'), html);

    console.log(`Generated: /blog/${slug}/index.html`);
    console.log(`  Title: ${meta.title}`);
    console.log(`  Image: ${meta.image}`);
  }

  console.log('Blog pages generated successfully!');
}

main();
