import { parseDocument, DomUtils } from 'htmlparser2';

import loadConfig from './loadConfig.js';
let config = await loadConfig();

function getLineFromIndex(html, index) {
    return html.slice(0, index).split('\n').length;
  }


async function storeLocations ()
{
   const locationData = {};

    const cssFiles = await globby (`${config.teamGit}/**/*.css`);

    for(const cssFile of cssFiles)
    {
        const css = await fs.promises.readFile (cssFile, 'utf-8');

        if (!css.includes ('--scope-hash'))
            continue;

        await postcss([
            async (root) => {
                
                root.walkDecls ('--scope-hash', decl =>
                {
                    const hash = decl.value.split (' ')[0].trim();

                    if (locationData[hash]) //we are only saving new, currently unique content
                        return;

                    const className = decl.parent.selector.split (',')[0].trim().slice (1);
                    const baseClass = className.replace(/-\w+$/, '');

                    locationData[hash] = { css: [{
                        file: cssFile,
                        lineNumber: decl.parent.source.start.line,
                        className,
                        baseClass
                    }]}
                }
                );
        }])
    }

}