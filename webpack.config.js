const { resolve } = require('path');
const glob = require('glob');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { EsbuildPlugin } = require('esbuild-loader');
const { ProvidePlugin, BannerPlugin } = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const isProd = process.env.NODE_ENV === 'production';
const SANDBOX_SUFFIX = '-sandbox';

const config = {
  mode: isProd ? 'production' : 'development',
  entry: glob.sync('./src/widgets/**/*.tsx').reduce((entries, file) => {
    const relative = path
      .relative('src/widgets', file)
      .replace(/\.[tj]sx?$/, '')
      .replace(/\\/g, '/');
    const absoluteFile = resolve(__dirname, file);
    entries[relative] = absoluteFile;
    entries[`${relative}${SANDBOX_SUFFIX}`] = absoluteFile;
    return entries;
  }, {}),
  output: {
    path: resolve(__dirname, 'dist'),
    filename: '[name].js',
    publicPath: '',
  },
  resolve: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
  module: {
    rules: [
      {
        test: /\.(ts|tsx|jsx|js)$/,
        exclude: /node_modules/,
        loader: 'esbuild-loader',
        options: { loader: 'tsx', target: 'es2020' },
      },
      {
        test: /\.css$/i,
        use: [isProd ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    isProd ? new MiniCssExtractPlugin({ filename: '[name].css' }) : undefined,
    new HtmlWebpackPlugin({
      templateContent: `
        <body></body>
        <script type="text/javascript">
          const queryParams = Object.fromEntries(new URLSearchParams(window.location.search).entries());
          const widgetName = queryParams["widgetName"];
          if (widgetName == undefined) document.body.innerHTML += "Widget ID not specified.";
          const script = document.createElement("script");
          script.type = "module";
          script.src = widgetName + "${SANDBOX_SUFFIX}.js";
          document.body.appendChild(script);
        </script>
      `,
      filename: 'index.html',
      inject: false,
    }),
    new ProvidePlugin({ React: 'react', reactDOM: 'react-dom' }),
    new BannerPlugin({
      banner: (file) =>
        !file.chunk.name.includes(SANDBOX_SUFFIX) ? 'const IMPORT_META=import.meta;' : '',
      raw: true,
    }),
    new CopyPlugin({ patterns: [{ from: 'public', to: '' }, { from: 'README.md', to: '' }] }),
    !isProd ? new ReactRefreshWebpackPlugin() : undefined,
  ].filter(Boolean),
  optimization: isProd
    ? { minimize: true, minimizer: [new EsbuildPlugin({ target: 'es2020' })] }
    : undefined,
  devServer: !isProd
    ? {
        port: 8080,
        hot: true,
        compress: true,
        watchFiles: ['src/**/*', 'public/**/*'],
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'baggage, sentry-trace',
        },
      }
    : undefined,
};

module.exports = config;
