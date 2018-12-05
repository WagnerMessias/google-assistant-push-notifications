const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const functions = require('firebase-functions');
const {dialogflow,Suggestions,UpdatePermission} = require('actions-on-google'); 
const request = require('request');

app = dialogflow({debuf:true})

//welcome não pode de ser utilizada para intent de push
app.intent('welcome', (conv) => {

    conv.ask('Seja Bem-Vindo!');

    if (conv.surface.capabilities.has('actions.capability.SCREEN_OUTPUT')) {
        conv.ask(new Suggestions('Receber Resultados'));
    }  
});

//Consulta o ultimo resultado da mega
app.intent('result-mega-sena', (conv) => {
    
    let concursosRef =  db.collection("concursos").orderBy("numero",'desc').limit(1);
    return concursosRef.get()
            .then(function(querySnapshot) {
                
                let ultimoConcurso = querySnapshot.docs[0];
                conv.close(`Concurso número ${ultimoConcurso.get("numero")} realizado no dia ${ultimoConcurso.get("data")} dezenas sorteadas: ${ultimoConcurso.get("dezenas").toString()} Boa Sorte!`);      
            })
            .catch(function(error) {
                console.error("Error getting documents: ", error);
                conv.close("Não foi possivel consultar o resultado, tente mais tarde.");
            });
});

//Solicita permissão para notificar o usuário
app.intent('setup-push', (conv) => {

    if (!conv.surface.capabilities.has('actions.capability.SCREEN_OUTPUT')) {
        conv.close('No momento, as notificações push não são compatíveis com os alto-falantes ativados por voz.');
    }

    conv.ask(new UpdatePermission({intent: 'result-mega-sena'}));
});

//Lida com o retorno da solicitação de permissão 
app.intent('finish-push-setup', (conv) => {

    if (conv.arguments.get('PERMISSION')) {

        if(conv.arguments.get('UPDATES_USER_ID')){

            let idUser = conv.arguments.get('UPDATES_USER_ID');
            let data = {userId: idUser, intent: 'result-mega-sena'};
            
           return db.collection('userNotifications').add(data)
           .then(ref => {
                conv.close('Você será notificado quando sair um novo resultado.');
                console.log('Added document with ID: ', ref.id);
            });
            
        }else{

          conv.close('Você já concedeu permissão anteriormente.');
        }
      } else {

        conv.close('Certo, você não será notificado.');
      }  
});

exports.fulfillment = functions.https.onRequest(app)


exports.notifyUsers = functions.https.onRequest((req, resp) => {

    //Validando acesso a function 
    if(req.query.key == functions.config().cron.key){

    return  request({
            url: 'https://confiraloterias.com.br/api/json/?loteria=megasena&token=7VraRYY2Vw48IDK',
            json: true
          }, function(error, response, body) {

            if(!error){
                let concurso = body.concurso;

                return isNewResult(concurso).then(result => {

                    if(result){
                        let data = {data: concurso.data, dezenas: concurso.dezenas, numero: concurso.numero};

                        //Salvando novo resultado da mega
                        return db.collection('concursos').add(data
                            ).then(ref => {
                                
                                let usersRef =  db.collection('userNotifications').where("intent","==","result-mega-sena");
                            
                                return usersRef.get()
                                        .then(function(snapUsers) {

                                            if(snapUsers.size > 0){
                                               sendNotifications(snapUsers);
                                               resp.status(200).send("Envio de notificações executado");
                                            }else{
                                                console.info("Nenhum usuário encontrado");
                                                resp.status(200).send("Nenhum usuário encontrado");
                                            }
                                        });
                             });

                    }else{
                        console.info('Sem novo resultado');
                        resp.status(200).send("ok");
                    }      
                });


            }else{
                console.error('Error get send: ' + error);
            }
          });
        
        
    }else{
        resp.status(401).send("Não autorizado");
    }


});//firebase use test-english-7cd86

function isNewResult(concurso){
    
    let concursosRef =  db.collection("concursos").orderBy("numero",'desc').limit(1);
    return concursosRef.get()
            .then(function(querySnapshot) {
                let ultimoConcurso = querySnapshot.docs[0];

                if(ultimoConcurso.get("numero") != concurso.numero){
                    return true;
                }else{
                    return false;
                }
            })
            .catch(function(error) {
                console.error("Error getting documents: ", error);
                return false;
            });
}

const {google} = require('googleapis');
const key = require(PATH_TO_KEY);

let jwtClient = new google.auth.JWT(
    key.client_email, null, key.private_key,
    ['https://www.googleapis.com/auth/actions.fulfillment.conversation'],
    null
);

function sendNotifications(snapUsers){

    jwtClient.authorize((err, tokens) => {

        if(!err){

            snapUsers.forEach(docUser =>{
                let user = docUser.data();

                let notif = {
                    userNotification: {
                    title: 'Novo resultado',
                    },
                    target: {
                    userId: user.userId,
                    intent: user.intent,
                    // Expects a IETF BCP-47 language code (i.e. en-US)
                    locale: 'pt-BR'
                    },
                };
                request.post('https://actions.googleapis.com/v2/conversations:send', {
                    'auth': {
                    'bearer': tokens.access_token,
                    },
                    'json': true,
                    'body': {'customPushMessage':notif},
                }, (error, httpResponse, body) => {
                        console.info(httpResponse.statusCode + ': ' + httpResponse.statusMessage);
                    if(error){
                        console.error('Error notification send: ' + err);
                    }
                });
                
            });
    }else{
        console.error('Error authorize google: ' + err);
    }

    });
}