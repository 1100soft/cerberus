export const credentialHelpLinks=[
  {label:'GNOME: unlock a keyring',url:'https://help.gnome.org/seahorse/keyring-unlock.html'},
  {label:'KDE: manage wallets',url:'https://docs.kde.org/stable_kf6/en/kwalletmanager/kwalletmanager/introduction.html'},
];
export function ciAccessNotice(failures:{repository:string;message:string}[]){
  const details=failures.map(item=>`${item.repository}\n${item.message}`).join('\n\n');
  if(!failures.some(item=>/credential storage is unavailable|platform secure storage|DBus error|secret service|system credential store/i.test(item.message)))return {title:'CI access needs attention',message:details};
  const affected=failures.filter(item=>/credential storage is unavailable|platform secure storage|DBus error|secret service|system credential store/i.test(item.message));
  const others=failures.filter(item=>!affected.includes(item));
  return {
    title:'GitHub credential store is not responding',
    message:`Affected projects: ${affected.map(item=>item.repository).join(', ')}.\n\nThe app cannot read saved GitHub credentials from this computer’s password store. CI monitoring will retry automatically. This does not mean a CI workflow failed.${others.length?'\n\nOther access issues:\n'+others.map(item=>`${item.repository}: ${item.message}`).join('\n\n'):''}`,
    steps:[
      'Open your system password manager (Passwords and Keys on GNOME, or KWallet Manager on KDE). Open or unlock the wallet used by GitCerberus if it is locked.',
      'If it is already unlocked, or the manager does not respond, save your work and sign out of your desktop session, then sign back in. This restarts the session services used by the password store.',
      'Open GitCerberus again and let monitoring retry. Reconnect the GitHub account only if the app then reports that its token is missing or expired. Signing in again alone will not fix an unresponsive password store.',
    ],links:credentialHelpLinks,details,
  };
}
