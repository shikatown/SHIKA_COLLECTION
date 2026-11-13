/* 管理モードのパスワードを照合するための、塩・回数・ハッシュ値を作る道具。
   パスワードの文字そのものはリポジトリに書かないこと。
   打ったコマンドがシェルの履歴に残ることがあるので、気になるなら履歴を消すこと。 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';

if (process.argv[2] === undefined) {
  console.log('使い方: node tools/make-admin-hash.mjs <新しいパスワード>');
} else {
  const salt = randomBytes(16);
  const iterations = 150000;
  const hash = pbkdf2Sync(process.argv[2], salt, iterations, 32, 'sha256');
  console.log(`const ADMIN_PASSWORD_SALT = '${salt.toString('hex')}';`);
  console.log(`const ADMIN_PASSWORD_ITERATIONS = ${iterations};`);
  console.log(`const ADMIN_PASSWORD_HASH = '${hash.toString('hex')}';`);
}
