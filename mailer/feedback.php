<?php
require 'PHPMailerAutoload.php';
require 'form_setting.php';

if(isset($_POST)){
	$name = $_POST['name'];
	$email = $_POST['email'];
	$subject = $_POST['email'];
	$message = $_POST['message'];

	$messages  = "<h3>New message from the site " .$fromName. "</h3> \r\n";
	$messages .= "<ul>";
	$messages .= "<li><strong>Name: </strong>" .$name."</li>";
	$messages .= "<li><strong>Email: </strong>" .$email."</li>";
	$messages .= "<li><strong>Subject: </strong>" .$subject."</li>";
	$messages .= "<li><strong>Message: </strong>" .$message."</li>";
	$messages .= "</ul> \r\n";

	$mail = new PHPMailer;

	// If SMTP settings provided in form_setting.php, configure SMTP
	if(isset($use_smtp) && $use_smtp===true) {
		$mail->isSMTP();
		$mail->Host = $smtp_host;
		$mail->Port = $smtp_port;
		$mail->SMTPAuth = $smtp_auth;
		if(!empty($smtp_secure)) $mail->SMTPSecure = $smtp_secure;
		$mail->Username = $smtp_username;
		$mail->Password = $smtp_password;
	}

	$mail->From = $from;
	$mail->FromName = $fromName;
	$mail->addAddress($to, 'Admin');

	$mail->isHTML(true);
	$mail->CharSet = $charset;

	$mail->Subject = $subj;
	$mail->Body    = $messages;

	if(!$mail->send()) {
	    // for debugging, return error message when DEBUG param present
	    $resp = array('status'=>0);
	    if(isset($_GET['debug']) && $_GET['debug']==1){
	        $resp['error'] = $mail->ErrorInfo;
	    }
	    print json_encode($resp);
	} else {
	    print json_encode(array('status'=>1));
	}

}

?>
