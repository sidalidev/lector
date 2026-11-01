// Lance le vrai processus principal de Lector avec un dossier de données
// jetable : aucune chaîne, aucun vault ni réglage de l'utilisateur n'est lu.
const { app } = require('electron')

app.setPath('userData', process.env.LECTOR_TEST_USER_DATA)
require('../../front/desktop/main.js')
