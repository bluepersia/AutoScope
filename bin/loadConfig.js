import path from 'path';

export default async function loadConfig ()
{
    return await import(path.resolve(process.cwd(), 'auto-scope.config.js')).then (mod => mod.default);
}