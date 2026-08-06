import app from "./app.js";

const start = async () => {
    const Port = 8080;
    try{
        await app.listen(
            {
                port: Port,
                host: '0.0.0.0'

            }
            
        );
        console.log(`server is running on port ${Port}`);

    }
    catch(err){
        app.log.error(err);
        process.exit(1);

    }
}


start();