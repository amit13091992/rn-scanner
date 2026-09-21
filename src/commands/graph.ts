import { buildDependencyGraph } from '../utils/dependencyGraph.js';
import { printHeader, printSuccess, printError, printInfo } from '../utils/terminal.js';
import { emitStructuredOutput, type HtmlOption } from '../utils/htmlOutput.js';

export interface GraphOptions {
  json?: boolean;
  html?: HtmlOption;
  /** Render as Graphviz DOT instead of the default summary/JSON — for piping into `dot`/other graph tooling. */
  dot?: boolean;
  cwd?: string;
}

/**
 * Exposes the raw dependency graph `why`/`tree`/`security`/`sbom` already build internally,
 * as data rather than a rendered tree — `tree` is for a human reading one package's place in
 * the hierarchy; `graph` is for handing the whole structure to something else (a script, a
 * DOT-based graph renderer). `--json` gives every node with its id/name/version/parents/
 * children; `--dot` gives a Graphviz `digraph` a `dot -Tpng` (or similar) can render directly.
 */
export async function graphCommand(options: GraphOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const jsonMode = !!options.json || !!options.html;
  let graphMissing = false;

  try {
    const graph = await buildDependencyGraph(cwd);

    if (!graph) {
      const error = 'No project or lockfile found';
      if (jsonMode) {
        emitStructuredOutput({ error }, 'Dependency Graph', options);
      } else {
        printError(error);
      }
      graphMissing = true;
    } else if (options.dot) {
      const lines = ['digraph dependencies {'];
      graph.nodes.forEach((node, id) => {
        const label = id === graph.root ? 'your-app' : `${node.name}@${node.version}`;
        lines.push(`  "${id}" [label="${label.replace(/"/g, '\\"')}"];`);
      });
      graph.nodes.forEach((node, id) => {
        node.children.forEach((childId) => {
          lines.push(`  "${id}" -> "${childId}";`);
        });
      });
      lines.push('}');
      console.log(lines.join('\n'));
    } else {
      const nodes = [...graph.nodes.entries()].map(([id, node]) => ({
        id,
        name: id === graph.root ? (node.name || 'your-app') : node.name,
        version: node.version,
        parents: node.parents,
        children: node.children,
        dev: node.dev,
        optional: node.optional,
      }));

      if (jsonMode) {
        emitStructuredOutput({ manager: graph.manager, hierarchyComplete: graph.hierarchyComplete, root: graph.root, nodeCount: nodes.length, nodes }, 'Dependency Graph', options);
      } else {
        printHeader('Dependency Graph');
        printInfo(`Package manager: ${graph.manager}`);
        if (graph.hierarchyComplete) {
          printSuccess(`Full transitive hierarchy: ${nodes.length} node(s)`);
        } else {
          printInfo(`Direct-dependency-only hierarchy (not fully resolved for "${graph.manager}"): ${nodes.length} node(s)`);
        }
        printInfo('Use --json for the full node/edge data, or --dot to render with Graphviz (e.g. `rn-dep-scanner graph --dot | dot -Tpng -o graph.png`).');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (jsonMode) {
      emitStructuredOutput({ error: `Fatal error: ${message}` }, 'Dependency Graph', options);
    } else {
      printError(`Fatal error: ${message}`);
    }
    process.exit(1);
    return;
  }

  if (graphMissing) {
    process.exit(1);
  }
}
