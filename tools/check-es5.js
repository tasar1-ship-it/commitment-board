// Parses the page's own script as strict ES5 (the vendored Firebase files are not ours and are not checked).
var fs = require('fs'), acorn = require('acorn');
var html = fs.readFileSync(process.argv[2], 'utf8');
var re = /<script>([\s\S]*?)<\/script>/g, m, n = 0;
while ((m = re.exec(html))) { acorn.parse(m[1], { ecmaVersion: 5 }); n++; }
console.log('ES5_OK inline scripts parsed: ' + n);
var own = html.replace(/<style>[\s\S]*?<\/style>/, '');
var hits = (own.match(/=>|\bconst\s|\blet\s|`|\basync\s|\?\.|\.\.\./g) || []);
console.log('modern-syntax pattern hits: ' + hits.length + (hits.length ? ' ' + JSON.stringify(hits.slice(0, 10)) : ''));
