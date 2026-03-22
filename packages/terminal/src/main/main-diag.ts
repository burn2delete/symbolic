import { app } from "electron";

import { write } from "./store";

export function wireDiag() {
  process.on("uncaughtException", (err) => {
    write("process.uncaught", {
      msg: err.message,
      stack: err.stack,
    });
  });
  process.on("unhandledRejection", (err) => {
    write("process.rejection", {
      err:
        err instanceof Error
          ? { msg: err.message, stack: err.stack }
          : String(err),
    });
  });
  app.on("render-process-gone", (_event, web, info) => {
    write("render.gone", {
      reason: info.reason,
      exit_code: info.exitCode,
      url: web.getURL(),
    });
  });
  app.on("child-process-gone", (_event, info) => {
    write("child.gone", {
      type: info.type,
      reason: info.reason,
      name: info.name,
      service: info.serviceName,
      exit_code: info.exitCode,
    });
  });
}
