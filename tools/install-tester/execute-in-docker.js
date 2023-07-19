module.exports = function (distro, steps) {
  const Dockerode = require("dockerode");
  const streams = require("memory-streams");
  const fs = require("fs");
  const yaml = require("js-yaml");

  const config = yaml.load(fs.readFileSync("./config/setup.yaml", "utf8"));

  const stdout = new streams.WritableStream();
  const stderr = new streams.WritableStream();

  const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

  const setup = config[distro].setup.join(" && ");
  if (!setup) {
    throw new Error(`No setup found for ${distro}`);
  }

  const asUser = `su tester -c 'cd ~ && ${steps
    .join(" && ")
    .replace("\n", " && ")} && kong version'`;

  const completeString = `${setup} && ${asUser}`;

  return new Promise((resolve, reject) => {
    docker.run(
      config[distro].image,
      ["bash", "-c", completeString],
      [stdout, stderr],
      { Tty: false, HostConfig: { AutoRemove: true }, platform: "linux/amd64" },
      function (err, data, container) {
        if (err) {
          return reject(err);
        }
        const lines = stdout
          .toString()
          .split("\n")
          .filter((l) => l);
        const version = lines[lines.length - 1];
        return resolve({
          version,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          jobConfig: {
            image: config[distro].image,
            commands: completeString,
          },
        });
      }
    );
  });
};
