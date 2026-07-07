// OmniFocus JXA: find tasks by name (substring match) or id.
// Invoked as: osascript -l JavaScript find.scpt '<json>'
// where <json> = { name?, id?, project? }
// Prints an array of matching tasks: [{ id, name, note, completed, projectName }].

function run(argv) {
  'use strict';
  var args = JSON.parse(argv[0] || '{}');
  var of = Application('OmniFocus');
  of.includeStandardAdditions = true;
  var doc = of.defaultDocument;

  function describe(task) {
    var proj = null;
    try {
      var c = task.containingProject();
      if (c) proj = c.name();
    } catch (e) {}
    return {
      id: task.id(),
      name: task.name(),
      note: task.note(),
      completed: task.completed(),
      projectName: proj,
    };
  }

  // Fast path: lookup by id.
  if (args.id) {
    try {
      var byId = doc.flattenedTasks.whose({ id: args.id })();
      if (byId && byId.length > 0) {
        return JSON.stringify([describe(byId[0])]);
      }
    } catch (e) {}
    return JSON.stringify([]);
  }

  // Search across all flattened tasks by name substring.
  var query = args.name ? args.name.toLowerCase() : '';
  var results = [];
  var tasks = doc.flattenedTasks();
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var n = (t.name() || '').toLowerCase();
    if (!query || n.indexOf(query) >= 0) {
      results.push(describe(t));
    }
  }
  return JSON.stringify(results);
}
