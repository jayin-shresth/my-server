import os from 'node:os';

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME || process.env.USER || 'careflow-test',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE || process.cwd(),
  });
}
