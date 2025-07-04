
export default {
  inputDir: 'src', // Write all your vanilla content here
  outputDir: 'dist', // This is where the converted files will be created
  dontFlatten: false, // Keep compound selectors rather than automatic BEM-style flattening
  useNumbers: true, // Use numbers (1, 2, 3, 4) instead of hash (3d0ccd)
  dontHashFirst: true, // The first scope of a certain type doesn't get an ID or hash
  mergeCss: false, // Merge all the CSS into one file
  writeRuntimeMap: false, // Write the map needed for runtime scoping
  teamSrc: false, // Team src folder/s to scan for class names already used
  teamGit: 'team-repo',
  flattenCombis: [], //Flatten combinators, e.g. > becomes _a_
  overrideConfig: {},
};
