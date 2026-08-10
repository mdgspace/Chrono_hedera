const { execSync } = require('child_process');
const cmds = [
    'npx hardhat run scripts/deploy/deploy.ts --network testnet',
    'npx hardhat run scripts/flows/01-setup.ts --network testnet',
    'npx hardhat run scripts/flows/10-associate.ts --network testnet',
    'npx hardhat run scripts/flows/12-set-keeper.ts --network testnet',
    'npx hardhat run scripts/flows/02-lend.ts --network testnet',
    'npx hardhat run scripts/flows/07-provide-stability.ts --network testnet'
];
for(let cmd of cmds){
    console.log('Running: ' + cmd);
    execSync(cmd, {stdio: 'inherit'});
}
console.log('All done!');
