const functions = require('firebase-functions');
const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');

exports.generateWalletPass = functions.https.onRequest(async (req, res) => {
  // CORS configuration to allow your frontend to trigger this download
  res.set('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  try {
    // Note: You will need to create a 'certs' and 'pass-template' folder in your functions directory 
    // to store your Apple Developer certificates and pass images (icon.png, logo.png).
    const certificates = {
      wwdr: fs.readFileSync(path.resolve(__dirname, './certs/wwdr.pem')),
      signerCert: fs.readFileSync(path.resolve(__dirname, './certs/signerCert.pem')),
      signerKey: fs.readFileSync(path.resolve(__dirname, './certs/signerKey.pem')),
      signerKeyPassphrase: 'YOUR_SECRET_PASSPHRASE' 
    };

    const pass = new PKPass({
      'pass.json': fs.readFileSync(path.resolve(__dirname, './pass-template/pass.json')),
      'icon.png': fs.readFileSync(path.resolve(__dirname, './pass-template/icon.png')),
      'icon@2x.png': fs.readFileSync(path.resolve(__dirname, './pass-template/icon@2x.png')),
      'logo.png': fs.readFileSync(path.resolve(__dirname, './pass-template/logo.png')),
    }, certificates);

    pass.primaryFields.push({
      key: 'points',
      label: 'PAW POINTS',
      value: req.query.points || '0'
    });
    
    pass.secondaryFields.push({
      key: 'tier',
      label: 'LOYALTY TIER',
      value: req.query.tier || 'Standard'
    });

    pass.barcode = {
      format: 'PKBarcodeFormatQR',
      message: `client-id-${req.query.clientId || 'guest'}`,
      messageEncoding: 'iso-8859-1'
    };

    const passBuffer = await pass.getAsBuffer();
    
    res.set('Content-Type', 'application/vnd.apple.pkpass');
    res.set('Content-Disposition', 'attachment; filename="paw-points.pkpass"');
    res.status(200).send(passBuffer);
    
  } catch (error) {
    console.error("Error generating wallet pass:", error);
    res.status(500).send("Could not generate wallet pass");
  }
});
