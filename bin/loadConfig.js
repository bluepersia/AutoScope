import path from 'path';

export default async function loadConfig ()
{
    try {
        const config = await import(path.resolve(process.cwd(), 'auto-scope.config.js')).then (mod => mod.default);
    }
    catch(err)
    {
        const e = new Error ("Config not found. Use 'npx install-auto-scope' to generate one.")
       
        e.stack = '';
        throw (e);
    }
}