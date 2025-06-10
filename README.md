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
