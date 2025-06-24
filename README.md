![Tool Logo](https://github.com/bluepersia/AutoScope/raw/master/assets/logo.jpg)

**This tool has been tested with small tests. The next step is to apply it to realistic projects.**
**Vite/Webpack will be supported, but currently untested.**
**Thanks for your patience**

_Feel free to reach out about which features you'd like prioritized for testing. For example, should I focus on dontFlatten: true vs false scenarios first? Understanding common use cases helps me test what matters most!_

Welcome to AutoScope compiler for CSS, HTML and JavaScript (React is in the works)!

The aim of this tool:

1. For team-wide adoption, eliminate all class collisions entirely.
2. For private adoption, reduce collision problems.

Regardless of whether you write Vanilla classes or BEM.

## 🛡️ How It Works

When collisions are detected during compilation, AutoScope automatically adds a suffix to class names (either a short hash or a number, based on your config) — no manual renaming needed.

For example, if you write unscoped (Vanilla) classes like this:

```html
<article class="recipe-card">
  <h3 class="title">Chocolate Cake Recipe</h3>
  <p class="desc">
    This rich and moist chocolate cake is perfect for celebrations or just a
    treat to satisfy your sweet tooth. Easy to bake and delicious to eat!
  </p>
  <ul class="ingredients">
    <li>2 cups flour</li>
    <li>1 ¾ cups sugar</li>
    <li>¾ cup cocoa powder</li>
  </ul>
  <p class="instructions">
    Preheat the oven to 350°F (175°C). Mix dry ingredients. Add eggs, milk, oil,
    and vanilla. Beat well. Bake for 30-35 minutes.
  </p>
</article>
```

If `dontFlatten` is set to false, AutoScope will convert nested classes into a flat BEM-style structure, using the outer block name as a prefix.

```html
<article class="recipe-card-2">
  <h3 class="recipe-card-2__title">Chocolate Cake Recipe</h3>
  <p class="recipe-card-2__desc">
    This rich and moist chocolate cake is perfect for celebrations or just a
    treat to satisfy your sweet tooth. Easy to bake and delicious to eat!
  </p>
  <ul class="recipe-card-2__ingredients">
    <li>2 cups flour</li>
    <li>1 ¾ cups sugar</li>
    <li>¾ cup cocoa powder</li>
  </ul>
  <p class="recipe-card-2__instructions">
    Preheat the oven to 350°F (175°C). Mix dry ingredients. Add eggs, milk, oil,
    and vanilla. Beat well. Bake for 30-35 minutes.
  </p>
</article>
```

Suffix + flattening resolves the collision.

Likewise, if you write BEM with `dontFlatten` set to true, you can write:

```html
<article class="recipe-card">
  <h3 class="recipe-card__title">Chocolate Cake Recipe</h3>
  <p class="recipe-card__desc">
    This rich and moist chocolate cake is perfect for celebrations or just a
    treat to satisfy your sweet tooth. Easy to bake and delicious to eat!
  </p>
  <ul class="recipe-card__ingredients">
    <li>2 cups flour</li>
    <li>1 ¾ cups sugar</li>
    <li>¾ cup cocoa powder</li>
  </ul>
  <p class="recipe-card__instructions">
    Preheat the oven to 350°F (175°C). Mix dry ingredients. Add eggs, milk, oil,
    and vanilla. Beat well. Bake for 30-35 minutes.
  </p>
</article>
```

And if a collision is detected, it resolves again to

```html
<article class="recipe-card-2"></article>
```

or if set to hash:

```html
<article class="recipe-card-c53df3"></article>
```

## 🛠️ How To Use

### 💅 CSS

Each CSS file in `inputDir` gets treated as its own scope. The filename is the scope name. Think of it as a block or module.
If your selectors do not start with the filename, the scope name will automatically be prepended to your selectors.
So instead of writing

```css
.recipe-card {
}
.recipe-card .title {
}
.recipe-card .img {
}
```

You can write

```css
.recipe-card {
}
.title {
}
.img {
}
```

### 🌐 HTML

Import your modules via:

```html
<meta name="auto-scope" content="./css/recipe-card.css" />
```

### 🟨 JavaScript

CSS files adjacent to your JavaScript will automatically be imported unless you include `.exclude.` in the file name.
Any function named `getScopedHtml` will be scoped.

```js
function getScopedHtml() {
  return `<article class="recipe-card"></article>`; //Scoping will be applied
}
```

### 🧱🎨 Compilation

During compilation, your HTML and CSS will be uniquely scoped automatically, and the CSS and HTML converted to the scoped versions.

#### `npx dev`

Starts dev mode, which watches your files in `inputDir` in realtime. Uses a sandbox environment folder `dev-temp`.

#### `npx build`

Build from `inputDir` to `outputDir`(or in private mode, to `teamSrc`)
In private mode, build regularly to commit significant changes. Your live edits only affect the temporary dev folder in dev mode, not the actual team repo.

### 🔒 Private Use (without team-wide adoption)

#### 🗂️ Organization

Set up a Git repo for your private work (can be offline), and inside it, add the Git repo of your team's project.
Set `teamGit` to the project repo, and `teamSrc` to the folder/s that contains the source files of the project.

#### 🔄 Workflow

##### 🚀 npx begin `<branch name>`

Before you begin your work, call this command. **Important:** this will download the team repo content back to your src on a new branch. _The download will be class-based (`.img`), not type-based (`img`)_

##### 🗂️ Where to Write Your Files

###### 📁 `inputDir`/ — For Your Scoped Work

###### 📁 teamRepo/ — For Team Content & Static Assets

##### 🔃 npx pull

Stay up to date with the master branch by regularly calling this command. Your scoped work will be merged in a temporary folder called `merge`, which is where you have to resolve conflicts, if there are any for your scoped work.

##### 🧹 npx end `<branch name>`

When you're done and you've submitted your work and it has been merged successfully to the master branch, call this command to:

1. Clean up temporary branches.
2. Pull from master.
3. If your personal repo is not online, just local, the working branch will be merged back into master.

##### 🎯 Git repo collisions

In private mode, collisions can happen due to git not being synced up perfectly, or other people using a name you already used.
When this happens, AutoScope will notify you about it, and that on next build, your suffix will be regenerated.
I recommend building and committing this immediately with a clear message about rename.

##### Other commands

`npx add`
`npx commit`

#### 💡 Hashes required

In private mode, your scopes need a hash for sync identification. It's applied only to the scope itself.

```css
.recipe-card {
  --scope-hash: xt2e34;
}
.recipe-card__title {
  /*No hash*/
}
```

```html
<article class="recipe-card" data-scope-hash="xt2e34">
  <h3 class="recipe-card__title">Chocolate Cake Recipe</h3>
</article>
```

#### 📝 File copying

`copyFiles` in config is automatically set to `teamGit`repo if left unset or set to `true`. You need the full content available relatively during development.

### 🧼 Formatters

AutoScope has integrated support for:

1. Prettier
2. ESLint
3. stylelint
4. beautify

Install the package of the formatter/s you would like AutoScope to automatically apply everywhere.

In the config, set up `formatters` like so:

```js
{
  formatters: {
    all: 'prettier';
  }
}
```

or

```js
{
  formatters: {
    html: 'beautify',
    css: 'prettier'
  }
}
```

or

```js
{
  formatters: {
    css: ['prettier', 'stylelint'];
  }
}
```

For each formatter, set up the config (if needed) in the same `formatters` object:

1. `prettierConfig`
2. `eslintConfig`
3. `stylelintConfig`
4. `beautifyConfig`

## 📦 Installation

`npx install-auto-scope` will install a default config, and mark `dist` and `dev-temp` folders on .gitignore.

## ⚙️ Config Options

| Option           | Type            | Default  | Description                                                    |
| ---------------- | --------------- | -------- | -------------------------------------------------------------- |
| `inputDir`       | string          | `'src'`  | The directory to compile from                                  |
| `outputDir`      | string          | `'dist'` | The directory to compile to                                    |
| `dontFlatten`    | boolean         | `false`  | Flatten nested classes into BEM-style names                    |
| `useNumbers`     | boolean         | `true`   | Use number suffixes instead of hashes                          |
| `dontHashFirst`  | boolean         | `true`   | Do not suffix the first occurence                              |
| `mergeCss`       | string          | `false`  | Merge all the CSS into one file                                |
| `teamGit`        | string          | `false`  | The git repo folder of the main project                        |
| `teamSrc`        | string/array    | `false`  | The src directories within the team git repo e.g.`src`         |
| `copyFiles`      | string/bool/arr | `false`  | Copy directory content to the output dir, as is                |
| `globalCss`      | glob/globs      | ``       | Files to exclude from scoping (for global styles)              |
| `flattenCombis`  | array/boolean   | `[]`     | Flatten combinators, e.g. from `>` to `_a_`                    |
| `overrideConfig` | object          | `{}`     | Override configs for certain files. Key = glob, value = object |
