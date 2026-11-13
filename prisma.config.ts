// Where Prisma finds the server's schema when it runs from the repo's root, as @prisma/client's
// install script does on a fresh `pnpm install`. The server's own postinstall and the build
// generate the client from packages/server as well.
export default { schema: 'packages/server/prisma/schema.prisma' };
