import { ModalClient } from "modal";

const modal = new ModalClient({ environment: process.env.MODAL_ENVIRONMENT });
const app = await modal.apps.fromName("modal-demos-sandbox", {
  createIfMissing: true,
});
const image = modal.images.fromRegistry("alpine:3.21");
const sandbox = await modal.sandboxes.create(app, image);

try {
  const command = await sandbox.exec(["echo", "Hello from a Modal Sandbox!"]);
  console.log(await command.stdout.readText());
} finally {
  await sandbox.terminate();
}
