# Ideas for the future

1. Auto-update CSS imports when moving CSS file.
2. `npx rename` - rename a block. Auto-updates imports and content project-wide.
3. `npx promote` - convert element to block. Auto-updates imports and content project-wide.

   The benefits of these tools would be to make BEM a seamless responsive process, rather than trying to do the impossible and guess the future, leading to premature abstraction, less readable code, etc.
   A block would simply be a _source of truth_, which you can create or expand at any moment, similar to a JS/TS class, using `Rename Symbol`, etc.
