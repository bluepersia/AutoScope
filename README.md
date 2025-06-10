![Tool Logo](./assets/logo.jpg)

Welcome to AutoScope compiler for CSS and HTML (React is in the works)!

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

### 🧱🎨 Compilation

During compilation, your HTML and CSS will be uniquely scoped automatically, and the CSS and HTML converted to the scoped versions.

### 🔒 Private Use (without team-wide adoption)

#### 🗂️ Organization

Set up your `inputDir` separate from the project repo, e.g. `'mySrc'`. Set `teamRepo` to the project repo, e.g. `'src'`.
Set `outputDir` to either:

1. Another folder, e.g. '`myDist`'
2. The team repo itself (use at own risk. The micro tests passed, but the build is constantly overwriting files again)

#### 🧹 Formatters

Ideally, the team should agree on certain code formatter/s to reduce Git conflicts.
AutoScope currently supports:

1. Prettier: `prettierConfig`
2. ESLint: `ESLintConfig`
3. Stylelint: `stylelintConfig`

Install the node package of the formatter.
Each formatter uses the config structure of the respective node package.

#### 🔄 Syncing

To keep your work up-to-date with the repo, you need to sync regularly.
For this, there are several CMD commands.

##### 🧬 npx team-sync

Downloads the team repo back to your local content. Use this command before getting to work, to assure your content is up-to-date.
**Note:** team-sync re-generates your classnames based on current styles in the team repo. This may override formatting details (e.g. whether .img was originally a class or an element selector), but the final output remains unchanged.

#### 🔃 npx pull

Pulls and merges from the master branch. Requires you to be on a different branch.
**Important:** npx pull ensures that colliding class names do not get committed and auto-resolves. Manual Git pulls may skip conflict resolution steps unique to AutoScope, leading to incorrect scoping.
**Always use this instead of manual Git pulls**

#### 🎯 npx resolve --name <class name>

Same as npx pull, but only syncs the specified class and resolves it to a new hash/suffix.
Use this when a collision has occured in the team repo to reset the suffix.

## ⚙️ Config Options

| Option            | Type            | Default  | Description                                           |
| ----------------- | --------------- | -------- | ----------------------------------------------------- |
| `inputDir`        | string          | `'src'`  | The directory to compile from                         |
| `outputDir`       | string          | `'dist'` | The directory to compile to                           |
| `dontFlatten`     | boolean         | `false`  | Flatten nested classes into BEM-style names           |
| `useNumbers`      | boolean         | `true`   | Use number suffixes instead of hashes                 |
| `dontHashFirst`   | boolean         | `true`   | Do not suffix the first occurence                     |
| `writeRuntimeMap` | string/boolean  | `false`  | Filepath for runtime JSON needed for HTML-in-JS       |
| `teamRepo`        | string/boolean  | `false`  | Scan a directory for conflicts (for private use)      |
| `mergeCss`        | string/boolean  | `false`  | Merge all the CSS into one file                       |
| `copyFiles`       | string/bool/arr | `false`  | Copy directory content to the output dir, as they are |
| `globalCss`       | glob/globs      | ``       | Files to exclude from scoping (for global styles)     |
| `flattenCombis`   | array/boolean   | `[]`     | Flatten combis, e.g. from > to _a_                    |
