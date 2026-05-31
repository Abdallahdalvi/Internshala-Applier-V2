const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: false,
    icon: 'src/icon',
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, electronVersion, platform, arch) => {
      const path = require('path');
      const fs = require('fs');
      const { execSync } = require('child_process');
      
      const itemsToCopy = [
        'package.json',
        'package-lock.json',
        'prepare-user.js',
        'dalvi-internshala-discovery.js',
        'ai-helper.js',
        'dalvi-ai.js',
        'dalvi-controller.js',
        'dalvi-jd-extractor.js',
        'dalvi-job-runner.js',
        'job-config.js',
        'job-config-validator.js',
        'job-schema.js',
        'job-intent.json',
        'ai',
        'config',
        'job-engine',
        'resume-engine',
        'src/icon.ico',
        'src/logo.png'
      ];
      
      for (const item of itemsToCopy) {
        const srcPath = path.join(__dirname, item);
        const destPath = path.join(buildPath, item);
        if (fs.existsSync(srcPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true });
        }
      }

      console.log('Installing production dependencies in build path:', buildPath);
      execSync('npm install --omit=dev --no-audit --no-fund', { cwd: buildPath, stdio: 'inherit' });
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
