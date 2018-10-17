var gulp = require('gulp');
var watch = require('gulp-watch');
var ts = require("gulp-typescript");
const clean = require('gulp-clean');
var log = require('fancy-log');
const runSequence = require('run-sequence');
var gulpSequence = require('gulp-sequence')
var angularExample = '/home/otavio/dev/petitbull/code/petitbull/examples/angular-editor/node_modules/petit-bull';
var sourceFiles = 'lib/*.ts';

var notifier = require('node-notifier');

gulp.task('start', function (callback) {
  log('-----------------------start-------------------!');
  callback();
});

gulp.task('clean', function () {
  return gulp.src('dist', { read: false })
    .pipe(clean());
});


gulp.task("build", function () {
  // var tsResult = gulp.src("lib/*.ts")
  //   .pipe(ts('tsconfig.json'));
  // return tsResult.js.pipe(gulp.dest("dist"));

  const merge = require('merge2');
  const tsProject = ts.createProject('tsconfig.json');

  var tsResult = tsProject.src()
    .pipe(tsProject());

  return merge([
    tsResult.dts.pipe(gulp.dest('./definitions')),
    tsResult.js.pipe(gulp.dest(tsProject.config.compilerOptions.outDir))
  ]);

});

// gulp.task('scripts', function () {

//   const merge = require('merge2');
//   const tsProject = ts.createProject('tsconfig.json');

//   var tsResult = tsProject.src()
//     .pipe(tsProject());

//   return merge([
//     tsResult.dts.pipe(gulp.dest('./definitions')),
//     tsResult.js.pipe(gulp.dest(tsProject.config.compilerOptions.outDir))
//   ]);

// });

gulp.task('copy', function (callback) {
  var copyResult = gulp.src('./dist/**/*.*')
    .pipe(gulp.dest(angularExample));
  callback();
});

gulp.task('end', function (callback) {
  log('-----------------------end-------------------!');
  notifier.notify({
    title: 'Production Build',
    message: 'Done',
    sound: true, // Only Notification Center or Windows Toasters
  });
  callback();
});

gulp.task('default', gulp.series('start', 'clean', 'build', 'copy', 'end'))

gulp.task('watch', function watch(done) {

  gulp.watch(sourceFiles)
    .on('change', function (a, b, c, d) {
      return gulp.series('start', 'clean', 'build', 'copy', 'end')();
    })

  done();
});