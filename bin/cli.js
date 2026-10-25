#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { extractDesignSystem, interactivePickElement } from '../src/extractor.js';
import { generateStarterProject } from '../src/generator.js';
import { startMcpServer } from '../src/mcp-server.js';

const program = new Command();

console.log(
  chalk.bold.hex('#A855F7')('\n⚡ STEAL-THIS-STACK ') +
  chalk.dim('v5.9 — Live DOM, Multi-Page Crawler & Computed CSS Reverse-Engineering Engine\n')
);

program
  .name('steal-this-stack')
  .description('Extract exact computed CSS tokens, fonts, animations, SVGs, and multi-page UI blueprints from any live URL.')
  .argument('[url]', 'Target website URL to reverse-engineer (e.g., https://linear.app)')
  .option('-o, --output <dir>', 'Output directory for generated starter repo', './stolen-stack')
  .option('-p, --pick', 'Launch interactive browser overlay to click and extract a single UI component or full webpage')
  .option('-c, --crawl <number>', 'Crawl and extract multiple internal pages automatically (e.g., --crawl 5)', parseInt)
  .option('--mcp', 'Run as a Model Context Protocol (MCP) server for Cursor / Claude Code')
  .action(async (url, options) => {
    try {
      if (options.mcp) {
        await startMcpServer();
        return;
      }

      if (!url) {
        console.log(chalk.yellow('Please provide a target URL or run with --mcp.\n'));
        console.log('Examples:');
        console.log(chalk.cyan('  npx steal-this-stack https://stripe.com'));
        console.log(chalk.cyan('  npx steal-this-stack https://linear.app --pick'));
        console.log(chalk.cyan('  npx steal-this-stack https://fiverr.com --crawl 5'));
        console.log(chalk.cyan('  npx steal-this-stack --mcp\n'));
        process.exit(1);
      }

      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      const outputDir = path.resolve(process.cwd(), options.output);
      const crawlPages = options.crawl && options.crawl > 0 ? options.crawl : 1;

      if (options.pick || options.crawl) {
        if (crawlPages > 1) {
          console.log(chalk.cyan(`🕸️  Launching Multi-Page Crawler (${crawlPages} pages max) on ${normalizedUrl}...`));
          console.log(chalk.dim('Automatically traversing internal links, hydrating scroll containers, and compiling 9.5/10 blueprints.\n'));
        } else {
          console.log(chalk.cyan(`🎯 Launching Interactive Component & Full-Site Picker on ${normalizedUrl}...`));
          console.log(chalk.dim('Hover & click any element, steal the full page, or click "Crawl 5 Pages" in the top bar.\n'));
        }

        const picked = await interactivePickElement(normalizedUrl, outputDir, crawlPages);
        const savedPath = (picked && (picked.studioFilePath || picked.stageFilePath || picked.filePath)) || outputDir;
        const totalCaptured = picked && picked.allPagesResults ? picked.allPagesResults.length : 1;

        console.log(chalk.green(`\n✔ Extracted ${totalCaptured} page(s) successfully!`));
        console.log(chalk.white(`  Studio launched at: ${chalk.bold(savedPath)}\n`));
        return;
      }

      const spinner = ora(`Spinning up headless Chromium & inspecting computed styles at ${chalk.bold(normalizedUrl)}...`).start();

      const designData = await extractDesignSystem(normalizedUrl);
      spinner.succeed(chalk.green(`Extracted live design tokens from ${chalk.bold(designData.meta.title || normalizedUrl)}`));

      console.log(chalk.dim('  ├─ ') + `Colors & CSS Variables: ${chalk.bold.cyan(designData.colors.palette.length)} unique tokens`);
      console.log(chalk.dim('  ├─ ') + `Typography Families:    ${chalk.bold.cyan(designData.typography.fontFamilies.join(', ') || 'System UI')}`);
      console.log(chalk.dim('  ├─ ') + `Transitions & Physics:  ${chalk.bold.cyan(designData.animations.transitions.length)} curves captured`);
      console.log(chalk.dim('  └─ ') + `Vector Assets (SVGs):   ${chalk.bold.cyan(designData.svgs.length)} icons extracted\n`);

      const genSpinner = ora(`Generating ready-to-code Tailwind project in ${chalk.bold(options.output)}...`).start();
      await generateStarterProject(designData, outputDir);
      genSpinner.succeed(chalk.green(`Starter project created at ${chalk.bold(outputDir)}`));

      console.log('\n' + chalk.bold.green('🚀 Next Steps:'));
      console.log(chalk.cyan(`  cd ${options.output}`));
      console.log(chalk.cyan(`  npx serve .`) + chalk.dim('  (or open index.html in your browser)\n'));
    } catch (error) {
      console.error(chalk.red(`\n✖ Execution failed: ${error.message}`));
      if (error.message && error.message.includes('Executable doesn\'t exist')) {
        console.log(chalk.dim('Tip: Install Playwright browser dependencies via: npx playwright install chromium'));
      }
      process.exit(1);
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(chalk.red(`\n✖ Unhandled error: ${err.message}`));
  process.exit(1);
}