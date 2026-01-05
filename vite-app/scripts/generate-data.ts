/**
 * Build-time data generation script
 *
 * This script runs before Vite build to generate JSON data files
 * that replace Next.js's getStaticProps functionality.
 */

import fs from 'fs'
import path from 'path'

// Placeholder - will be implemented in Phase 2
console.log('Generating data files...')

// Create empty placeholder files if they don't exist
const dataDir = path.join(process.cwd(), 'src/data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// Placeholder file tree
const fileTreePath = path.join(dataDir, 'fileTree.json')
if (!fs.existsSync(fileTreePath)) {
  fs.writeFileSync(fileTreePath, JSON.stringify({
    name: 'terminal',
    path: 'terminal',
    isDirectory: true,
    children: []
  }, null, 2))
}

// Placeholder translations
const translationsPath = path.join(dataDir, 'translations.json')
if (!fs.existsSync(translationsPath)) {
  fs.writeFileSync(translationsPath, JSON.stringify({}, null, 2))
}

console.log('Data files generated successfully!')
