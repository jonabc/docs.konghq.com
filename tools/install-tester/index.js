process.env.BASE_URL = "http://localhost:3000";

// Parse a format like [2.6.x/rhel/oss/yum-repository] into
// individual conditions
if (process.env.ONLY) {
  const only = process.env.ONLY.replace("[", "").replace("]", "");
  const [version, distro, package, method] = only.split("/");
  process.env.VERSION = version;
  process.env.DISTRO = distro;
  process.env.PACKAGE = package;
  process.env.METHOD = method;
}

const conditions = {
  version: (process.env.VERSION || "").split(",").filter((v) => v),
  distro: (process.env.DISTRO || "").split(",").filter((v) => v),
  method: (process.env.METHOD || "").split(",").filter((v) => v),
  package: (process.env.PACKAGE || "").split(",").filter((v) => v),
};

const debug = require("debug")("install-tester");
const yaml = require("js-yaml");
const fs = require("fs");
if (!fs.existsSync("./output")) {
  fs.mkdirSync("./output");
}

const { extractV2, extractV3 } = require("./instruction-extractor");
const run = require("./execute-in-docker");

(async function () {
  debug("Starting Install Tester");
  const config = yaml.load(fs.readFileSync("./config/jobs.yaml", "utf8"));
  for (let job of config) {
    for (let distro of job.distros) {
      let installOptions;
      if (job.version.slice(0, 2) === "2.") {
        installOptions = await extractV2(job.version, distro);
      } else {
        installOptions = await extractV3(job.version, distro);
      }
      for (let installOption of installOptions) {
        await runSingleJob(distro, job, installOption, conditions);
      }
    }
  }
})();

async function runSingleJob2(distro, job, installOption, conditions) {
  console.log(installOption);
}

async function runSingleJob(distro, job, installOption, conditions) {
  const marker = `${installOption.package}@${job.version} via ${installOption.type}`;
  const summary = `[${job.version}/${distro}/${installOption.package}/${installOption.type}]`;

  debug(`====== START ${marker} ======`);

  if ((skip = shouldSkip(conditions, job, distro, installOption, summary))) {
    if (!process.env.IGNORE_SKIPS) {
      console.log(skip);
    }
    return;
  }

  const expected = job.outputs[installOption.package];
  debug(`Expecting: ${expected}`);

  const { jobConfig, version, stdout, stderr } = await run(
    distro,
    installOption.blocks,
  );
  debug(`Got: ${version}`);

  // Create a file to re-run the command in one + debug
  fs.writeFileSync(
    `./output/${job.version}-${distro}-${installOption.package}-${installOption.type}.txt`,
    `docker run --platform linux/amd64 -it ${
      jobConfig.image
    } bash -c "${jobConfig.commands
      .replace(/"/g, '\\"')
      .replace(
        /\$/g,
        "\\$",
      )}; sleep 100000"\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
  );

  if (expected !== version) {
    console.log(`❌ ${summary} Expected: ${expected}, Got: ${version}`);

    if (!process.env.CONTINUE_ON_ERROR) {
      process.exit(1);
    }
  } else {
    console.log(`✅ ${summary}`);
  }

  debug(`====== END ${marker} ======`);
}

function shouldSkip(conditions, job, distro, installOption, summary) {
  if (conditions.version.length && !conditions.version.includes(job.version)) {
    return `⌛ ${summary} skipped | Version ${
      job.version
    }  not in [${conditions.version.join(", ")}]`;
  }

  if (conditions.distro.length && !conditions.distro.includes(distro)) {
    return `⌛ ${summary} skipped | Distro ${distro} not in [${conditions.distro.join(
      ", ",
    )}]`;
  }

  if (
    conditions.method.length &&
    !conditions.method.includes(installOption.type)
  ) {
    return `⌛ ${summary} skipped | Install method ${
      installOption.type
    } not in [${conditions.method.join(", ")}]`;
  }

  if (
    conditions.package.length &&
    !conditions.package.includes(installOption.package)
  ) {
    return `⌛ ${summary} skipped | Package ${
      installOption.package
    } not in [${conditions.package.join(", ")}]`;
  }

  return false;
}
